const io = require('socket.io-client')
    const mediasoupClient = require('mediasoup-client')
    
    const socket = io("/qllive")
    
    socket.on('connection-success', ({ socketId }) => {
      console.log(socketId)
    })
  const hai= "";
    let device
    let rtpCapabilities
    let producerTransport
    let consumerTransport
    let producer
    let consumer




    
    let params = {
      // mediasoup params
      encodings: [
        {
          rid: 'r0',
          maxBitrate: 100000,
          scalabilityMode: 'S1T3',
        },
        {
          rid: 'r1',
          maxBitrate: 300000,
          scalabilityMode: 'S1T3',
        },
        {
          rid: 'r2',
          maxBitrate: 900000,
          scalabilityMode: 'S1T3',
        },
      ],
      codecOptions: {
        videoGoogleStartBitrate: 1000
      }
    }
    
    const streamSuccess = async (stream) => {
      console.log(document.getElementById('localVideo'))
      document.getElementById('localVideo').srcObject = stream
      const track = stream.getVideoTracks()[0]
      params = {
        track,
        ...params
      }
    }
    
    const getLocalStream = () => {
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: {
            min: 640,
            max: 1920,
          },
          heigh: {
            min: 400,
            max: 1080,
          }
        }
      }).then(success =>{
        streamSuccess(success)
           
      }).catch(error =>{
         console.log(error)
      })
    }

    




    const createDevice = async () => {
      try {
        device = new mediasoupClient.Device()
    
        await device.load({
          routerRtpCapabilities: rtpCapabilities
        })
    
        console.log('RTP Capabilities', device.rtpCapabilities)
    
      } catch (error) {
        console.log(error)
        if (error.name === 'UnsupportedError')
          console.warn('browser not supported')
      }
    }
    
    const getRtpCapabilities = () => {
      socket.emit('getRtpCapabilities', (data) => {
        console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
    
        rtpCapabilities = data.rtpCapabilities
      })
    }
    
    const createSendTransport = () => {
      socket.emit('createWebRtcTransport', { sender: true }, ({ params }) => {
        if (params.error) {
          console.log(params.error)
          return
        }
    
        console.log(params)
    
        producerTransport = device.createSendTransport(params)
    
        producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            await socket.emit('transport-connect', {
              // transportId: producerTransport.id,
              dtlsParameters: dtlsParameters,
            })
    
            // Tell the transport that parameters were transmitted.
            callback()
    
          } catch (error) {
            errback(error)
          }
        })
    
        producerTransport.on('produce', async (parameters, callback, errback) => {
          console.log(parameters)
    
          try {
            await socket.emit('transport-produce', {
              // transportId: producerTransport.id,
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              appData: parameters.appData,
            }, ({ id }) => {
              // Tell the transport that parameters were transmitted and provide it with the
              // server side producer's id.
              callback({ id })
            })
          } catch (error) {
            errback(error)
          }
        })
      })
    }
    
    const connectSendTransport = async () => {
      producer = await producerTransport.produce(params)
    
      producer.on('trackended', () => {
        console.log('track ended')
    
        // close video track
      })
    
      producer.on('transportclose', () => {
        console.log('transport ended')
    
        // close video track
      })
    }
    
    const createRecvTransport = async () => {
      await socket.emit('createWebRtcTransport', { sender: false }, ({ params }) => {
        if (params.error) {
          console.log(params.error)
          return
        }
    
        console.log(params)
    
        // create the recv transport
        consumerTransport = device.createRecvTransport(params)
    
        consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            await socket.emit('transport-recv-connect', {
              // transportId: consumerTransport.id,
              dtlsParameters,
            })
    
            // Tell the transport that parameters were transmitted.
            callback()
          } catch (error) {
            // Tell the transport that something was wrong
            errback(error)
          }
        })
      })
    }
    
    const connectRecvTransport = async () => {
      await socket.emit('consume', {
        rtpCapabilities: device.rtpCapabilities,
      }, async ({ params }) => {
        if (params.error) {
          console.log('Cannot Consume')
          return
        }
    
        console.log(params)
        consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters
        })
    
        const { track } = consumer
        if(!track){
          console.log("null track")
        }
        document.getElementById('remoteVideo').srcObject = new MediaStream([track])
    
        socket.emit('consumer-resume')
      })
    }
   

    const init = ()=>{
        getLocalStream();
    }
    init();
    
    document.getElementById('start').addEventListener('click', getLocalStream)
