import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
const socket = io("ws://localhost:3002/qllive");
socket.on("connection-success", (success) => {
  console.log(success);
  console.log(socket.id);
});

const getLocalStream = () => {
  return navigator.getUserMedia(
    {
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        },
      },
    },
    streamSuccess,
    (error) => {
      console.log(error.message);
    }
  );
};
let device;
let rtpCapabilities;
let producerTransport;
let consumerTransport;
let producer;
let consumer;
let params = {
  encoding: [
    {
      rid: "r0",
      maxBitrate: 100000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r1",
      maxBitrate: 300000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r2",
      maxBitrate: 900000,
      scalabilityMode: "S1T3",
    },
  ],
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

const streamSuccess = (stream) => {
  document.getElementById("localVideo").srcObject = stream;
  const track = stream.getTracks()[0];
  params = {
    track,
    ...params,
  };
};
const createDevice = async () => {
  try {
    device = new mediasoupClient.Device();
    await device.load({ routerRtpCapabilities: rtpCapabilities });
    console.log("RTP capabilities loaded", rtpCapabilities);
  } catch (err) {
    console.log(err);
    if (err.name === "UnsupportedError") {
      console.error("browser not supported");
    }
  }
};

const getRtpCapabilities = async () => {
  socket.emit("getRouterRtpCapabilities", (data) => {
    console.log(`Router RTP Capabilities... ${data}`);
    rtpCapabilities = data;
  });
};

const createSendTransport = async () => {
  let sender = true;
  socket.emit("createWebRtcTransport", { sender: true }, ({ params }) => {
    if (params.error) {
      console.log(params.error);
      return;
    }
    console.log("createSendTransport ", params);
    producerTransport = device.createSendTransport(params);
    producerTransport.on(
      "connect",
      async ({ dtlsParameters }, callback, errback) => {
        try {
//          dtlsParameters.role = sender ? "server" : "client";
          await socket.emit("transport-connect", {
            dtlsParameters: dtlsParameters,
          });
          callback();
          sender = false;
        } catch (error) {
          console.log(error);
          errback(error);
        }
      }
    );

    producerTransport.on("produce", async (parameters, callback, errback) => {
      console.log("produce", parameters);
      try {
        await socket.emit(
          "transport-produce",
          {
            kind: parameters.kind,
            rtpParameters: parameters.rtpParameters,
            appData: parameters.appData,
          },
          ({ id }) => {
            callback({ id });
          }
        );
      } catch (error) {
        console.log(error);
        errback(error);
      }
    });
  });
};
const connectSendTransport = async () => {
  producer = await producerTransport.produce(params);
  producer.on("trackended", () => {
    console.log("trackended");
  });

  producer.on("transportclose", () => {
    console.log("track ended");
  });
};
const createRecvTransport = async () => {
  await socket.emit(
    "createWebRtcTransport",
    { sender: false },
    ({ params }) => {
      if (params.error) {
        console.log(params.error);
        return;
      }
      console.log("createRecvTransport ", params);
      consumerTransport = device.createRecvTransport(params);
      consumerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            await socket.emit("transport-recv-connect", {
              dtlsParameters,
            });
            callback();
          } catch (error) {
            console.log(error);
            errback(error);
          }
        }
      );
    }
  );
};

const connectRecvTransport = async () => {
  await socket.emit(
    "get-consumer",
    { rtpCapabilities: device.rtpCapabilities },
    async ({ params }) => {
      if (params.error) {
        console.log("cannot consume ", params.error);
        return;
      }
      console.log("get-consumer", params);
      consumer = await consumerTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });
      const { track } = consumer;
      document.getElementById("localVideo1").srcObject = new MediaStream([
        track,
      ]);
      socket.emit("consumer-resume");
    }
  );
};

function App() {
  return (
    <div>
      <h1>WEB RTC</h1>
      <video
        id="producer"
        style={{ width: 240, height: 240, backgroundColor: "black" }}
        autoPlay
        muted


      ></video>
      <video
        id="consumer"
        style={{ width: 240, height: 240, backgroundColor: "black" }}
        autoPlay
        muted
      ></video>

      <input type="text" id="sdp" />
      <button onClick={getLocalStream}>Open camera</button>
      <button onClick={getRtpCapabilities}>Get RTP capabilities</button>
      <button onClick={createDevice}>create Device</button>



      <button onClick={createSendTransport}>Create Transport</button>
      <button onClick={connectSendTransport}>Connect Transport</button>
      <button onClick={createRecvTransport}>create Recv Transport</button>
      <button onClick={connectRecvTransport}>Add Recv Trnsport</button>
    </div>
  );
}

export default App;
