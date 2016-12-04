'use strict';

exports.__esModule = true;
exports.SocketWrapper = undefined;

var _classCallCheck2 = require('babel-runtime/helpers/classCallCheck');

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

exports.connectionSmoother = connectionSmoother;

var _AsyncSubject = require('rxjs/AsyncSubject');

var _BehaviorSubject = require('rxjs/BehaviorSubject');

var _Subject = require('rxjs/Subject');

var _WebSocketSubject = require('rxjs/observable/dom/WebSocketSubject');

var _Observable = require('rxjs/Observable');

require('rxjs/add/observable/merge');

require('rxjs/add/observable/never');

require('rxjs/add/observable/timer');

require('rxjs/add/observable/defer');

require('rxjs/add/operator/filter');

require('rxjs/add/operator/share');

require('rxjs/add/operator/ignoreElements');

require('rxjs/add/operator/concat');

require('rxjs/add/operator/takeWhile');

require('rxjs/add/operator/publish');

require('rxjs/add/operator/cache');

var _socket = require('./socket');

var _serialization = require('./serialization');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var SocketWrapper = exports.SocketWrapper = function () {
  function SocketWrapper(_ref) {
    var _this = this;

    var url = _ref.url,
        handshakeMaker = _ref.handshakeMaker,
        _ref$keepalive = _ref.keepalive,
        keepalive = _ref$keepalive === undefined ? 60 : _ref$keepalive,
        _ref$WebSocketCtor = _ref.WebSocketCtor,
        WebSocketCtor = _ref$WebSocketCtor === undefined ? WebSocket : _ref$WebSocketCtor,
        websocket = _ref.websocket;
    (0, _classCallCheck3.default)(this, SocketWrapper);

    this.requestCounter = 0;
    this.status = new _BehaviorSubject.BehaviorSubject(_socket.STATUS_UNCONNECTED);
    this.handshakes = new _BehaviorSubject.BehaviorSubject();
    this.handshakeMaker = handshakeMaker;
    this.websockets = infiniteSockets({
      url: url,
      protocol: _socket.PROTOCOL_VERSION,
      socket: websocket,
      WebSocketCtor: WebSocketCtor,
      openObserver: function openObserver() {
        _this.sendHandshake();
      },
      closingObserver: function closingObserver() {
        return _this.status.next(_socket.STATUS_CLOSING);
      },
      closeObserver: function closeObserver() {
        _this.status.next(_socket.STATUS_DISCONNECTED);
        _this.cleanupHandshake();
      }
    });
    this.keepalive = _Observable.Observable.timer(keepalive * 1000, keepalive * 1000).switchMap(function () {
      return _this.makeRequest({ type: 'keepalive' });
    });
  }

  // Send the handshake if it hasn't been sent already. It also starts
  // the keepalive observable and cleans up after it when the
  // handshake is cleaned up.


  SocketWrapper.prototype.sendHandshake = function sendHandshake() {
    var _this2 = this;

    if (!this._handshakeSub) {
      this._handshakeSub = this.makeRequest(this._handshakeMaker()).subscribe({
        next: function next(n) {
          if (n.error) {
            _this2.status.next(_socket.STATUS_ERROR);
            _this2.handshake.error(new _socket.ProtocolError(n.error, n.error_code));
          } else {
            _this2.status.next(_socket.STATUS_READY);
            _this2.handshakes.next(n);
          }
        },
        error: function error(e) {
          _this2.status.next(_socket.STATUS_ERROR);
          _this2.handshakes.next(null);
          _this2.cleanupHandshake();
          _this2.ws.error(e);
        }
      });

      // Start the keepalive and make sure it's
      // killed when the handshake is cleaned up
      this._handshakeSub.add(this.keepalive.connect());
    }
    return this.handshakes;
  };

  SocketWrapper.prototype.send = function send(msg) {
    this.handshakes.filter(function (x) {
      return x !== null;
    }).take(1)
    // Any handshake will be mapped to the request
    .map(function () {
      return JSON.stringify((0, _serialization.serialize)(msg));
    })
    // The websocket's next method will be called with the request
    .subscribe(this.ws);
  };

  SocketWrapper.prototype.makeRequest = function makeRequest(rawRequest) {
    var _this3 = this;

    var shouldEndSubscription = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;
    var handshake = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;

    return new _Observable.Observable(function (observer) {
      var request_id = _this3.requestCounter++;
      var request = Object.assign({ request_id: request_id }, request);

      if (handshake) {
        _this3.ws.next(JSON.stringify((0, _serialization.serialize)(request)));
      } else {
        _this3.send(request);
      }

      var subscription = _this3.ws.subscribe({
        next: function next(resp) {
          // Multiplex by request id on all incoming messages
          if (resp.request_id === request_id) {
            if (resp.error !== undefined) {
              observer.error((0, _socket.ProtocolError)(resp.error, resp.error_code));
            }
            for (var _iterator = resp.data, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
              var _ref2;

              if (_isArray) {
                if (_i >= _iterator.length) break;
                _ref2 = _iterator[_i++];
              } else {
                _i = _iterator.next();
                if (_i.done) break;
                _ref2 = _i.value;
              }

              var d = _ref2;

              // Only need to deserialize data coming back
              observer.next((0, _serialization.deserialize)(d));
            }
            if (resp.state !== undefined) {
              // Create a little dummy object for sync notifications
              observer.next({
                type: 'state',
                state: resp.state
              });
            }
            if (resp.state === 'complete') {
              observer.complete();
            }
          }
        },
        error: function error(err) {
          observer.error(err);
        },
        complete: function complete() {
          observer.complete();
        }
      });

      return function () {
        if (shouldEndSubscription) {
          _this3.send({ request_id: request_id, type: 'end_subscription' });
        }
        subscription.unsubscribe();
      };
    });
  };

  return SocketWrapper;
}();

function connectionSmoother(horizonParams) {
  var controlSignals = new _Subject.Subject();
  var sockets = infiniteHorizonSockets(controlSignals, horizonParams);
  var statuses = sockets.switchMap(function (socket) {
    return socket.status;
  }).cache(1);

  return {
    controlSignals: controlSignals,
    sockets: sockets,
    handshakes: sockets.switchMap(function (socket) {
      return socket.handshake;
    }),
    statuses: statuses,
    sendRequest: function sendRequest(clientType, options) {
      var type = clientType === 'removeAll' ? 'remove' : clientType;
      return sockets
      // Each time we get a new socket, we'll send the request
      .switchMap(function (socket) {
        return socket.makeRequest({ type: type, options: options });
      })
      // Share to prevent re-sending requests whenever a subscriber shows up
      .share();
    },
    connect: function connect() {
      controlSignals.next('connect');
    },
    disconnect: function disconnect() {
      controlSignals.next('disconnect');
    }
  };
}

function infiniteSockets(signals, params) {
  return signals
  // We only care about two signals
  .filter(function (x) {
    return x === 'connect' || x === 'disconnect';
  })
  // Create a new socket if we're to connect
  .map(function (signalName) {
    if (signalName === 'connect') {
      return new _WebSocketSubject.WebSocketSubject(params);
    } else {
      return signalName;
    }
  })
  // Cache the last socket so we don't keep creating them on subscribe
  .cache(1)
  // Filter out disconnect signals so new subscribers don't get the cached
  // horizon socket after a disconnect message
  .filter(function (x) {
    return x === 'disconnect';
  });
}
//# sourceMappingURL=resilient-socket.js.map