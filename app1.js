/**
 * integrating mediasoup server with a node.js application
 */

/* Please follow mediasoup installation requirements */
/* https://mediasoup.org/documentation/v3/mediasoup/installation/ */
const express  = require( 'express')
const cors   = require( 'cors')

const  https =  require('httpolyglot')
const fs =  require('fs')
const path = require('path')
const mediasoup = require( 'mediasoup');
const { disconnect } = require('process')
const { Producer } = require('mediasoup-client/lib/Producer')
const { Consumer } = require('mediasoup-client/lib/Consumer')
const { consumers } = require('stream')
const config = require('./config');
const queue = new AwaitQueue();

const createServer = ()=>{
    const app = express()
    app.param('/:roomId', (req, res, next) => {
        res.send(`You need to specify a room name in the path e.g. 'https://127.0.0.1/sfu/room'`)
     })
     app.use('/sfu', express.static(path.join(__dirname, 'public')))
// SSL cert for HTTPS access
const options = {
    key: fs.readFileSync('./server/ssl/key.pem', 'utf-8'),
    cert: fs.readFileSync('./server/ssl/cert.pem', 'utf-8')
  }
  
  const httpsServer = https.createServer(options, app)
  const io = require("socket.io")(httpsServer, {cors: {origin: "*"}});
  
  
  httpsServer.listen(3002, () => {
    console.log('listening on port: ' + 3002)
  })
  
}



const peers = io.of('qllive')
let worker
let router
let producerTransport
let consumerTransport
let producer
let consumer
const rooms = new Map();
const mediasoupWorkers = [];

let nextMediasoupWorkerIdx = 0;


const createWorker = async () => {
  const { numWorkers } = config.mediasoup;
  for (let i = 0; i < numWorkers; ++i){
    worker = await mediasoup.createWorker({
      rtcMinPort: Number(config.mediasoup.workerSettings.rtcMinPort),
      rtcMaxPort: Number(config.mediasoup.workerSettings.rtcMaxPort),
    })
    console.log(`worker started pid ${worker.pid}`)

    worker.on('died', error => {
      console.error(`mediasoup worker has died ${worker.pid}`)
      setTimeout(() => process.exit(1), 2000) // exit in 2 seconds
    })
    mediasoupWorkers.push(worker);
    if (process.env.MEDIASOUP_USE_WEBRTC_SERVER !== 'false')
		{
			// Each mediasoup Worker will run its own WebRtcServer, so those cannot
			// share the same listening ports. Hence we increase the value in config.js
			// for each Worker.
			const webRtcServerOptions = utils.clone(config.mediasoup.webRtcServerOptions);
			const portIncrement = mediasoupWorkers.length - 1;

			for (const listenInfo of webRtcServerOptions.listenInfos)
			{
				listenInfo.port += portIncrement;
			}

			const webRtcServer = await worker.createWebRtcServer(webRtcServerOptions);

			worker.appData.webRtcServer = webRtcServer;
		}

        // Log worker resource usage every X seconds.
		setInterval(async () =>
		{
			const usage = await worker.getResourceUsage();

			logger.info('mediasoup Worker resource usage [pid:%d]: %o', worker.pid, usage);
		}, 120000);
  }
  


}

const init = ()=>{
    // We create a Worker as soon as our application starts
    createWorker();

    createServer();
}



const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
]

peers.on('connection', async ({rommId},socket) => {
  console.log(`RoomId ${roomId}`)
  console.log(socket.id),
  queue.push(async ()=>{
    const room = await getOrCreateRoom({});

  }).catch(error =>{
    console.log(`queue error ${error}`)
  })
  socket.emit('connection-success', {
    socketId: socket.id
  })

  socket.on('disconnect', () => {
    // do some cleanup
    console.log('peer disconnected')
  })


  // Client emits a request for RTP Capabilities
  // This event responds to the request
  socket.on('getRtpCapabilities', (callback) => {

    const rtpCapabilities = router.rtpCapabilities

    console.log('rtp Capabilities', rtpCapabilities)

    // call callback from the client and send back the rtpCapabilities
    callback({ rtpCapabilities })
  })

  // Client emits a request to create server side Transport
  // We need to differentiate between the producer and consumer transports
  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    console.log(`Is this a sender request? ${sender}`)
    // The client indicates if it is a producer or a consumer
    // if sender is true, indicates a producer else a consumer
    if (sender)
      producerTransport = await createWebRtcTransport(callback)
    else
      consumerTransport = await createWebRtcTransport(callback)
  })

  // see client's socket.emit('transport-connect', ...)
  socket.on('transport-connect', async ({ dtlsParameters }) => {
    console.log('DTLS PARAMS... ', { dtlsParameters })
    await producerTransport.connect({ dtlsParameters })
  })

  // see client's socket.emit('transport-produce', ...)
  socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
    // call produce based on the prameters from the client
    producer = await producerTransport.produce({
      kind,
      rtpParameters,
    })

    console.log('Producer ID: ', producer.id, producer.kind)

    producer.on('transportclose', () => {
      console.log('transport for this producer closed ')
      producer.close()
    })

    // Send back to the client the Producer's id
    callback({
      id: producer.id
    })
  })

  // see client's socket.emit('transport-recv-connect', ...)
  socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
    console.log(`DTLS PARAMS: ${dtlsParameters}`)
    await consumerTransport.connect({ dtlsParameters })
  })

  socket.on('consume', async ({ rtpCapabilities }, callback) => {
    try {
      // check if the router can consume the specified producer
      if (router.canConsume({
        producerId: producer.id,
        rtpCapabilities
      })) {
        // transport can now consume and return a consumer
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: false,
        })

        consumer.on('transportclose', () => {
          console.log('transport close from consumer')
        })

        consumer.on('producerclose', () => {
          console.log('producer of consumer closed')
        })

        // from the consumer extract the following params
        // to send back to the Client
        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        }

        // send the parameters to the client
        callback({ params })
      }
    } catch (error) {
      console.log(error.message)
      callback({
        params: {
          error: error
        }
      })
    }
  })

  socket.on('consumer-resume', async () => {
    console.log('consumer resume')
    await consumer.resume()
  })
})

const createWebRtcTransport = async (callback) => {
  try {
    const webRtcTransport_options = {
      listenIps: [
        {
          ip: '127.0.0.1', // replace with relevant IP address
        //  announcedIp: '127.0.0.1',
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    }
    // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
    let transport = await router.createWebRtcTransport(webRtcTransport_options)
    console.log(`transport id: ${transport.id}`)

    transport.on('dtlsstatechange', dtlsState => {
      if (dtlsState === 'closed') {
        transport.close()
      }
    })

    transport.on('close', () => {
      console.log('transport closed')
    })

    // send back to the client the following prameters
    callback({
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      }
    })

    return transport

  } catch (error) {
    console.log(error)
    callback({
      params: {
        error: error
      }
    })
  }
}





async function getOrCreateRoom({ roomId })
{
	let room = rooms.get(roomId);

	// If the Room does not exist create a new one.
	if (!room)
	{
        console.log(`Room does not Exists ${roomId}`);

		const mediasoupWorker = getMediasoupWorker();

		room = await createRoom({ mediasoupWorker, roomId });

		rooms.set(roomId, room);
		room.on('close', () => rooms.delete(roomId));
	}

	return room;
}


const  getMediasoupWorker = ()=>{
	const worker = mediasoupWorkers[nextMediasoupWorkerIdx];

	if (++nextMediasoupWorkerIdx === mediasoupWorkers.length)
		nextMediasoupWorkerIdx = 0;

	return worker;
}
const createRoom =  async({ mediasoupWorker, roomId })=>{
	console.info('create() [roomId:%s]', roomId);
    const { mediaCodecs } = config.mediasoup.routerOptions;
    const router = await mediasoupWorker.createRouter({ mediaCodecs })

    const audioLevelObserver = await router.createAudioLevelObserver({
            maxEntries : 1,
            threshold  : -80,
            interval   : 800
        });
        const activeSpeakerObserver = await router.createActiveSpeakerObserver();
        const webRtcServer = mediasoupWorker.appData.webRtcServer;


}


