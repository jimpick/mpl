import EventEmitter from 'events'

import Dat from 'dat-node'
import Automerge from 'automerge'

const hardcodedPeers = new Map([
  [1, '81bfdf7c33048ca93fa7fd3aed04335a5c0910010ce9cdcb579aed11d0310cee'],
  [2, '7a76619ae6e9fe39e763180f8eb009312954af5c605e839bc5db64b6f5a28b3a']
])

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
        this.peerJoined(key)
        const historyStream = dat.archive.history()
        historyStream.on('data', data => {
          console.log(`History ${index}:`, data)
        })
      })
    }
  }

  peerJoined(peer) {
    console.log('peer ' + peer + ' joined')
    if (peer == this.datKey) { return }
    if (!this.Peers[peer]) {
      this.Peers[peer] = new Automerge.Connection(this.docSet, msg => {
        console.log('Automerge.Connection> send to ' + peer + ':', msg)

        if (this.dat) {
          const version = this.dat.archive.version
          const file = `/${peer}/${version + 1}.json`
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
