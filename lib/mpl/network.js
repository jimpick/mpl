'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require('events');

var _events2 = _interopRequireDefault(_events);

var _datNode = require('dat-node');

var _datNode2 = _interopRequireDefault(_datNode);

var _automerge = require('automerge');

var _automerge2 = _interopRequireDefault(_automerge);

var _pQueue = require('p-queue');

var _pQueue2 = _interopRequireDefault(_pQueue);

var _lodash = require('lodash');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var hardcodedPeers = new Map([[1, '7e126fc4db0690b39bcb6d0f00530d4f689789a0d54387b90cf45b0f03a34810'], [2, 'bc7661690802779f8ae52bea28ae81d3488f2266623c65b25f7d42eb36c6e267']]);
var lastWritten = new Map();
var lastRead = {};

var Network = function (_EventEmitter) {
  _inherits(Network, _EventEmitter);

  // TODO: reimplement 
  //  - friendly user names
  //  - multiple document support
  function Network(docSet) {
    _classCallCheck(this, Network);

    var _this = _possibleConstructorReturn(this, (Network.__proto__ || Object.getPrototypeOf(Network)).call(this));

    _this.peerNumber = parseInt(process.env.PEER_NUMBER, 10);
    if (!_this.peerNumber) {
      throw new Error('PEER_NUMBER environment variable not set');
      // process.exit(1)
    }
    _this.datDir = 'node-' + _this.peerNumber;

    _this.Peers = {};
    _this.peerMetadata = {};

    _this.selfInfo = null;
    _this.name = 'Unset Name';

    _this.docSet = docSet;

    _this.connected = false;
    _this.downloadQueue = new _pQueue2.default({ concurrency: 1 });
    _this.backupLastRead = (0, _lodash.throttle)(_this.backupLastReadUnthrottled, 15000);
    return _this;
  }

  _createClass(Network, [{
    key: 'connect',
    value: function connect() {
      var _this2 = this;

      if (this.connected) throw "network already connected - disconnect first";

      // Start sharing our peer
      (0, _datNode2.default)(this.datDir, { indexing: false }, function (err, dat) {
        if (err) throw err; // What is the right way to handle errors here?

        _this2.dat = dat;
        _this2.datKey = _this2.dat.archive.key.toString('hex');
        if (hardcodedPeers.get(_this2.peerNumber) !== _this2.datKey) {
          throw new Error('Key of Dat archive node-' + _this2.peerNumber + ' does not matched hardcoded value');
        }
        console.log('Joined as node-' + _this2.peerNumber + ': ' + _this2.datKey);

        dat.joinNetwork(function (err) {
          if (err) {
            console.error('joinNetwork error', err);
            throw err;
          }
          console.log('Dat network joined');
          var network = dat.network;
          var connected = network.connected,
              connecting = network.connecting,
              queued = network.queued;

          console.log('Dat Network:', connected, connecting, queued);
        });
        _this2.loadLastReadJson(function (err) {
          if (err) {
            console.error('Error loading lastRead.json, continuing...', err);
          } else {
            console.log('lastRead:', lastRead);
          }
          _this2.followOtherPeers();
        });
      });

      this.connected = true;
    }
  }, {
    key: 'loadLastReadJson',
    value: function loadLastReadJson(cb) {
      this.dat.archive.readFile('/lastRead.json', function (err, data) {
        if (err) return cb(err);
        try {
          var json = JSON.parse(data);
          Object.assign(lastRead, json);
          cb();
        } catch (e) {
          console.error('Exception', e);
          cb(e);
        }
      });
    }
  }, {
    key: 'followOtherPeers',
    value: function followOtherPeers() {
      var _this3 = this;

      var _loop = function _loop(index, datUrl) {
        if (index === _this3.peerNumber) return 'continue';
        console.log('Following node-' + index + ': ' + datUrl);
        var options = {
          key: datUrl,
          temp: true,
          sparse: true
        };
        (0, _datNode2.default)('./not-used', options, function (err, dat) {
          dat.joinNetwork();
          var key = dat.key.toString('hex');
          _this3.peerJoined(index, key);
          var historyStream = dat.archive.history();
          var regex = new RegExp('^/' + _this3.datKey + '/(\\d+).json$');
          historyStream.on('data', function (data) {
            var type = data.type,
                name = data.name,
                version = data.version;

            if (type !== 'put') return;
            var match = name.match(regex);
            if (match) {
              if (lastRead[key] && version < lastRead[key]) return;
              // console.log(`Received Message from node-${index} #${match[1]}`)
              var genDownloadJob = function genDownloadJob(nodeNumber, messageNumber, dat, data) {
                return function () {
                  console.log('Message from node-' + nodeNumber + ' #' + messageNumber + ':');
                  return _this3.downloadAndReceiveMessage(dat, data);
                };
              };
              var downloadJob = genDownloadJob(index, match[1], dat, data);
              _this3.downloadQueue.add(downloadJob);
              /*
              this.downloadQueue.add(this.downloadAndReceiveMessage(
                index, match[1], dat, data
              ))
              */
            }
          });
        });
      };

      // Start following other peers
      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = hardcodedPeers[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var _ref = _step.value;

          var _ref2 = _slicedToArray(_ref, 2);

          var index = _ref2[0];
          var datUrl = _ref2[1];

          var _ret = _loop(index, datUrl);

          if (_ret === 'continue') continue;
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator.return) {
            _iterator.return();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }
    }
  }, {
    key: 'readDatFile',
    value: function readDatFile(dat, version, file) {
      // console.log('Jim readDatFile', version, file)
      var promise = new Promise(function (resolve, reject) {
        // Fails when retrieving a specific version. Bug?
        // const archive = dat.archive.checkout(version)
        var archive = dat.archive;
        archive.readFile(file, function (err, content) {
          if (err) {
            console.error('readDatFile error', err);
            return reject(err);
          }
          if (!content) {
            console.error('readDatFile empty content');
            return reject(new Error('readDatFile empty content'));
          }
          // console.log('Jim2 readDatFile', err, content.toString())
          resolve(content.toString());
        });
        // setTimeout(resolve, 20)
      });
      return promise;
    }
  }, {
    key: 'downloadAndReceiveMessage',
    value: function downloadAndReceiveMessage(dat, data) {
      var _this4 = this;

      var version = data.version,
          file = data.name;
      // const promise = Promise.resolve()

      var promise = this.readDatFile(dat, version, file).then(function (content) {
        try {
          var message = JSON.parse(content);
          console.log('  Message:', message);
          var fromKey = dat.key.toString('hex');
          if (_this4.Peers[fromKey]) {
            _this4.Peers[fromKey].receiveMsg(message);
            lastRead[fromKey] = version;
            _this4.backupLastRead();
          } else {
            // Should never happen
            throw new Error('No peer registered for ' + fromKey);
          }
        } catch (e) {
          console.error('Exception:', e);
        }
      }).catch(function (err) {
        console.error('downloadAndReceiveMessage error', err);
      });
      return promise;
    }
  }, {
    key: 'peerJoined',
    value: function peerJoined(index, peer) {
      var _this5 = this;

      console.log('node-' + index + ' (' + peer + ') joined');
      if (peer == this.datKey) {
        return;
      }
      if (!this.Peers[peer]) {
        this.Peers[peer] = new _automerge2.default.Connection(this.docSet, function (msg) {
          if (_this5.dat) {
            var lastVersion = lastWritten.get(index);
            var nextVersion = lastVersion ? lastVersion + 1 : _this5.dat.archive.version + 1;
            lastWritten.set(index, nextVersion);
            console.log('Send to node-' + index + ' #' + nextVersion + ':', msg);

            var file = '/' + peer + '/' + nextVersion + '.json';
            var json = JSON.stringify(msg, null, 2);
            _this5.dat.archive.writeFile(file, json, function (err) {
              if (err) {
                console.error('writeFile error', err);
              }
            });
          }
        });

        this.Peers[peer].open();
      }
      return this.Peers[peer];
    }
  }, {
    key: 'backupLastReadUnthrottled',
    value: function backupLastReadUnthrottled() {
      console.log('Backup last read to Dat archive', Date.now());
      var json = JSON.stringify(lastRead, null, 2);
      this.dat.archive.writeFile('lastRead.json', json, function (err) {
        if (err) {
          console.error('Error writing lastRead.json to Dat archive');
        }
      });
    }
  }, {
    key: 'setName',
    value: function setName(name) {
      this.name = name;
    }
  }, {
    key: 'broadcastActiveDocId',
    value: function broadcastActiveDocId(docId) {
      // todo: this.webRTCSignaler.broadcastActiveDocId(docId)
    }
  }, {
    key: 'disconnect',
    value: function disconnect() {
      if (this.connected == false) throw "network already disconnected - connect first";
      console.log("NETWORK DISCONNECT");
      dat.close(function (err) {
        if (err) {
          console.error('Dat close error', error);
        }
      });
      this.connected = false;
    }
  }]);

  return Network;
}(_events2.default);

exports.default = Network;