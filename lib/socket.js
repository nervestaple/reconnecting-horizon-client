'use strict';

exports.__esModule = true;
exports.HorizonSocket = exports.ProtocolError = exports.STATUS_DISCONNECTED = exports.STATUS_CLOSING = exports.STATUS_ERROR = exports.STATUS_READY = exports.STATUS_UNCONNECTED = exports.PROTOCOL_VERSION = undefined;

var _classCallCheck2 = require('babel-runtime/helpers/classCallCheck');

var _classCallCheck3 = _interopRequireDefault(_classCallCheck2);

var _possibleConstructorReturn2 = require('babel-runtime/helpers/possibleConstructorReturn');

var _possibleConstructorReturn3 = _interopRequireDefault(_possibleConstructorReturn2);

var _inherits2 = require('babel-runtime/helpers/inherits');

var _inherits3 = _interopRequireDefault(_inherits2);

var _AsyncSubject = require('rxjs/AsyncSubject');

var _BehaviorSubject = require('rxjs/BehaviorSubject');

var _Subject = require('rxjs/Subject');

var _WebSocketSubject2 = require('rxjs/observable/dom/WebSocketSubject');

var _Observable = require('rxjs/Observable');

require('rxjs/add/observable/merge');

require('rxjs/add/observable/never');

require('rxjs/add/observable/timer');

require('rxjs/add/operator/filter');

require('rxjs/add/operator/share');

require('rxjs/add/operator/ignoreElements');

require('rxjs/add/operator/concat');

require('rxjs/add/operator/takeWhile');

require('rxjs/add/operator/publish');

require('rxjs/add/operator/cache');

var _serialization = require('./serialization.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var PROTOCOL_VERSION = exports.PROTOCOL_VERSION = 'rethinkdb-horizon-v0';

// Before connecting the first time
var STATUS_UNCONNECTED = exports.STATUS_UNCONNECTED = { type: 'unconnected' };
// After the websocket is opened and handshake is completed
var STATUS_READY = exports.STATUS_READY = { type: 'ready' };
// After unconnected, maybe before or after connected. Any socket level error
var STATUS_ERROR = exports.STATUS_ERROR = { type: 'error' };
// Occurs right before socket closes
var STATUS_CLOSING = exports.STATUS_CLOSING = { type: 'closing' };
// Occurs when the socket closes
var STATUS_DISCONNECTED = exports.STATUS_DISCONNECTED = { type: 'disconnected' };

var ProtocolError = exports.ProtocolError = function (_Error) {
  (0, _inherits3.default)(ProtocolError, _Error);

  function ProtocolError(msg, errorCode) {
    (0, _classCallCheck3.default)(this, ProtocolError);

    var _this = (0, _possibleConstructorReturn3.default)(this, _Error.call(this, msg));

    _this.errorCode = errorCode;
    return _this;
  }

  ProtocolError.prototype.toString = function toString() {
    return this.message + ' (Code: ' + this.errorCode + ')';
  };

  return ProtocolError;
}(Error);

// Wraps native websockets with a Subject, which is both an Subscriber
// and an Observable (it is bi-directional after all!). This version
// is based on the rxjs.observable.dom.WebSocketSubject implementation.


var HorizonSocket = exports.HorizonSocket = function (_WebSocketSubject) {
  (0, _inherits3.default)(HorizonSocket, _WebSocketSubject);

  // Deserializes a message from a string. Overrides the version
  // implemented in WebSocketSubject
  HorizonSocket.prototype.resultSelector = function resultSelector(e) {
    return (0, _serialization.deserialize)(JSON.parse(e.data));
  };

  // We're overriding the next defined in AnonymousSubject so we
  // always serialize the value. When this is called a message will be
  // sent over the socket to the server.


  HorizonSocket.prototype.next = function next(value) {
    var request = JSON.stringify((0, _serialization.serialize)(value));
    _WebSocketSubject.prototype.next.call(this, request);
  };

  function HorizonSocket() {
    var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
        url = _ref.url,
        handshakeMaker = _ref.handshakeMaker,
        _ref$keepalive = _ref.keepalive,
        keepalive = _ref$keepalive === undefined ? 60 : _ref$keepalive,
        _ref$WebSocketCtor = _ref.WebSocketCtor,
        WebSocketCtor = _ref$WebSocketCtor === undefined ? WebSocket : _ref$WebSocketCtor,
        websocket = _ref.websocket;

    (0, _classCallCheck3.default)(this, HorizonSocket);

    // some new lines here
    // Completes or errors based on handshake success. Buffers
    // handshake response for later subscribers (like a Promise)
    var _this2 = (0, _possibleConstructorReturn3.default)(this, _WebSocketSubject.call(this, {
      url: url,
      protocol: PROTOCOL_VERSION,
      socket: websocket,
      WebSocketCtor: WebSocketCtor,
      openObserver: {
        next: function next() {
          return _this2.sendHandshake();
        }
      },
      closingObserver: {
        next: function next() {
          _this2.status.next(STATUS_CLOSING);
        }
      },
      closeObserver: {
        next: function next() {
          _this2.status.next(STATUS_DISCONNECTED);
          _this2.cleanupHandshake();
        }
      }
    }));

    _this2.handshake = new _AsyncSubject.AsyncSubject();
    _this2._handshakeMaker = handshakeMaker;
    _this2._handshakeSub = null;

    _this2.keepalive = _Observable.Observable.timer(keepalive * 1000, keepalive * 1000).switchMap(function () {
      return _this2.makeRequest({ type: 'keepalive' });
    });

    // This is used to emit status changes that others can hook into.
    _this2.status = new _BehaviorSubject.BehaviorSubject(STATUS_UNCONNECTED);
    // Keep track of subscribers so we's can decide when to
    // unsubscribe.
    _this2.requestCounter = 0;
    // A map from request_ids to an object with metadata about the
    // request. Eventually, this should allow re-sending requests when
    // reconnecting.
    _this2.activeRequests = new Map();
    _this2._output.subscribe({
      // This emits if the entire socket errors (usually due to
      // failure to connect)
      error: function error() {
        return _this2.status.next(STATUS_ERROR);
      }
    });
    return _this2;
  }

  HorizonSocket.prototype.cleanupHandshake = function cleanupHandshake() {
    if (this._handshakeSub) {
      this._handshakeSub.unsubscribe();
    }
  };

  HorizonSocket.prototype.getRequest = function getRequest(request) {
    return Object.assign({ request_id: this.requestCounter++ }, request);
  };

  // Send the handshake if it hasn't been sent already. It also starts
  // the keepalive observable and cleans up after it when the
  // handshake is cleaned up.


  HorizonSocket.prototype.sendHandshake = function sendHandshake() {
    var _this3 = this;

    if (!this._handshakeSub) {
      this._handshakeSub = this.makeRequest(this._handshakeMaker()).subscribe({
        next: function next(n) {
          if (n.error) {
            _this3.status.next(STATUS_ERROR);
            _this3.handshake.error(new ProtocolError(n.error, n.error_code));
          } else {
            _this3.status.next(STATUS_READY);
            _this3.handshake.next(n);
            _this3.handshake.complete();
          }
        },
        error: function error(e) {
          _this3.status.next(STATUS_ERROR);
          _this3.handshake.error(e);
          _this3.cleanupHandshake();
          _this3.error(e);
        }
      });

      // Start the keepalive and make sure it's
      // killed when the handshake is cleaned up
      this._handshakeSub.add(this.keepalive.connect());
    }
    return this.handshake;
  };

  // Incorporates shared logic between the inital handshake request and
  // all subsequent requests.
  // * Generates a request id and filters by it
  // * Send `end_subscription` when observable is unsubscribed


  HorizonSocket.prototype.makeRequest = function makeRequest(rawRequest) {
    var _this4 = this;

    var shouldEndSub = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

    return new _Observable.Observable(function (observer) {
      var self = _this4;
      var request = _this4.getRequest(rawRequest);
      var request_id = request.request_id;

      var requestSent = false;
      self.sendHandshake().subscribe({
        error: function error(e) {
          observer.error(e); // error request if the handshake errors
        },
        complete: function complete() {
          self.next(request); // send the request when the handshake is done
          requestSent = true;
        }
      });

      var subscription = self.subscribe({
        next: function next(resp) {
          // Multiplex by request id on all incoming messages
          if (resp.request_id === request_id) {
            if (resp.error !== undefined) {
              observer.error(ProtocolError(resp.error, resp.error_code));
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

              observer.next(d);
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
        if (requestSent && shouldEndSub) {
          self.next({ request_id: request_id, type: 'end_subscription' });
        }
        subscription.unsubscribe();
      };
    });
  };

  return HorizonSocket;
}(_WebSocketSubject2.WebSocketSubject);
//# sourceMappingURL=socket.js.map