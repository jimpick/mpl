import EventEmitter from 'events'

import Dat from 'dat-node'
import Automerge from 'automerge'
import PQueue from 'p-queue'

const hardcodedPeers = new Map([
  [1, '81bfdf7c33048ca93fa7fd3aed04335a5c0910010ce9cdcb579aed11d0310cee'],
  [2, '7a76619ae6e9fe39e763180f8eb009312954af5c605e839bc5db64b6f5a28b3a']
])
const lastWritten = new Map()

export default class Network extends EventEmitter {
  // TODO: reimplement 
  //  - friendly user names
  //  - multiple document support
  constructor(docSet) {
    super()

    this.peerNumber = parseInt(process.env.PEER_NUMBER, 10)
    if (!this.peerNumber) {
      throw new Error('PEER_NUMBER environment variable not set')
      // process.exit(1)
    }
    this.datDir = `node-${this.peerNumber}`

    this.Peers = {}
    this.peerMetadata = {}

    this.selfInfo = null;
    this.name = 'Unset Name'

    this.docSet = docSet

    this.connected = false
    this.downloadQueue = new PQueue({concurrency: 1})
  }

  connect() {
    if (this.connected) throw "network already connected - disconnect first"

    // Start sharing our peer
    Dat(this.datDir, {indexing: false}, (err, dat) => {
      if (err) throw err  // What is the right way to handle errors here?

      this.dat = dat
      this.datKey = this.dat.archive.key.toString('hex')
      if (hardcodedPeers.get(this.peerNumber) !== this.datKey) {
        throw new Error(`Key of Dat archive node-${this.peerNumber} does not matched hardcoded value`)
      }
      console.log(`Joined as node-${this.peerNumber}: ${this.datKey}`)

      this.followOtherPeers()

      dat.joinNetwork(err => {
        if (err) {
          console.error('joinNetwork error', err)
          throw err
        }
        console.log('Dat network joined')
        const { network } = dat
        const { connected, connecting, queued } = network
        console.log('Dat Network:', connected, connecting, queued)
      })
    })

    this.connected = true
  }

  followOtherPeers() {
    // Start following other peers
    for (const [index, datUrl] of hardcodedPeers) {
      if (index === this.peerNumber) continue
      console.log(`Following node-${index}: ${datUrl}`)
      const options = {
        key: datUrl,
        temp: true,
        sparse: true
      }
      Dat('./not-used', options, (err, dat) => {
        dat.joinNetwork()
        const key = dat.key.toString('hex')
        this.peerJoined(index, key)
        const historyStream = dat.archive.history()
        const regex = new RegExp(`^/${this.datKey}/(\\d+)\.json$`)
        historyStream.on('data', data => {
          const {type, name, version} = data
          if (type !== 'put') return
          const match = name.match(regex)
          if (match) {
            // console.log(`Received Message from node-${index} #${match[1]}`)
            const genDownloadJob = (nodeNumber, messageNumber, dat, data) =>
              () => {
                console.log(`Message from node-${nodeNumber} #${messageNumber}:`)
                return this.downloadAndReceiveMessage(dat, data)
              }
            const downloadJob = genDownloadJob(index, match[1], dat, data)
            this.downloadQueue.add(downloadJob)
            /*
            this.downloadQueue.add(this.downloadAndReceiveMessage(
              index, match[1], dat, data
            ))
            */
          }
        })
      })
    }
  }

  readDatFile(dat, version, file) {
    // console.log('Jim readDatFile', version, file)
    const promise = new Promise((resolve, reject) => {
      // Fails when retrieving a specific version. Bug?
      // const archive = dat.archive.checkout(version)
      const archive = dat.archive
      archive.readFile(file, (err, content) => {
        if (err) {
          console.error('readDatFile error', err)
          return reject(err)
        }
        if (!content) {
          console.error('readDatFile empty content')
          return reject(new Error('readDatFile empty content'))
        }
        // console.log('Jim2 readDatFile', err, content.toString())
        resolve(content.toString())
      })
      // setTimeout(resolve, 20)
    })
    return promise
  }

  downloadAndReceiveMessage(dat, data) {
    const { version, name: file } = data
    // const promise = Promise.resolve()
    const promise = this.readDatFile(dat, version, file)
      .then(content => {
        try {
          const message = JSON.parse(content)
          console.log('  Message:', message)
          const fromKey = dat.key.toString('hex')
          if (this.Peers[fromKey]) {
            this.Peers[fromKey].receiveMsg(message)
          } else {
            // Should never happen
            console.log('JimZ')
            throw new Error(`No peer registered for ${fromKey}`)
          }
        } catch (e) {
          console.error('Exception:', e)
        }
      })
      .catch(err => {
        console.error('downloadAndReceiveMessage error', err)
      })
    return promise
  }

  peerJoined(index, peer) {
    console.log(`node-${index} (${peer}) joined`)
    if (peer == this.datKey) { return }
    if (!this.Peers[peer]) {
      this.Peers[peer] = new Automerge.Connection(this.docSet, msg => {
        if (this.dat) {
          const lastVersion = lastWritten.get(index)
          const nextVersion = lastVersion ?
            lastVersion + 1 : this.dat.archive.version + 1
          lastWritten.set(index, nextVersion)
          console.log(`Send to node-${index} #${nextVersion}:`, msg)

          const file = `/${peer}/${nextVersion}.json`
          const json = JSON.stringify(msg, null, 2)
          this.dat.archive.writeFile(file, json, err => {
            if (err) {
              console.error('writeFile error', err)
            }
          })
        }

      })

      this.Peers[peer].open()
    }
    return this.Peers[peer]
  }

  message(message) {
    console.log('Automerge.Connection> receive ' + message.from + ': ' + message.data.toString())
    let contents = JSON.parse(message.data.toString());
    if (contents.metadata) {
      this.receivePeerMetadata()
    }
    // we'll send this message to automerge too, just in case there are clocks or deltas included with it
    this.Peers[message.from].receiveMsg(contents)
  }

  setName(name) {
    this.name = name
  }

  broadcastActiveDocId(docId) {
    // todo: this.webRTCSignaler.broadcastActiveDocId(docId)
  }

  disconnect() {
    if (this.connected == false) throw "network already disconnected - connect first"
    console.log("NETWORK DISCONNECT")
    dat.close(err => {
      if (err) {
        console.error('Dat close error', error)
      }
    })
    this.connected = false
  }
}
