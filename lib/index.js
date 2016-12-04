'use strict';

exports.__esModule = true;
exports.default = Horizon;

var _BehaviorSubject = require('rxjs/BehaviorSubject');

require('rxjs/add/observable/of');

require('rxjs/add/observable/from');

require('rxjs/add/operator/catch');

require('rxjs/add/operator/concatMap');

require('rxjs/add/operator/map');

require('rxjs/add/operator/filter');

var _ast = require('./ast');

var _socket = require('./socket');

var _auth = require('./auth');

var _model = require('./model');

var defaultHost = typeof window !== 'undefined' && window.location && '' + window.location.host || 'localhost:8181';
var defaultSecure = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' || false;

function Horizon() {
  var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
      _ref$host = _ref.host,
      host = _ref$host === undefined ? defaultHost : _ref$host,
      _ref$secure = _ref.secure,
      secure = _ref$secure === undefined ? defaultSecure : _ref$secure,
      _ref$path = _ref.path,
      path = _ref$path === undefined ? 'horizon' : _ref$path,
      _ref$lazyWrites = _ref.lazyWrites,
      lazyWrites = _ref$lazyWrites === undefined ? false : _ref$lazyWrites,
      _ref$authType = _ref.authType,
      authType = _ref$authType === undefined ? 'unauthenticated' : _ref$authType,
      _ref$keepalive = _ref.keepalive,
      keepalive = _ref$keepalive === undefined ? 60 : _ref$keepalive,
      WebSocketCtor = _ref.WebSocketCtor,
      websocket = _ref.websocket;

  // If we're in a redirection from OAuth, store the auth token for
  // this user in localStorage.

  var tokenStorage = new _auth.TokenStorage({ authType: authType, path: path });
  tokenStorage.setAuthFromQueryParams();

  var url = 'ws' + (secure ? 's' : '') + '://' + host + '/' + path;

  // This is the object returned by the Horizon function. It's a
  // function so we can construct a collection simply by calling it
  // like horizon('my_collection')
  function horizon(name) {
    return new _ast.Collection(sendRequest, name, lazyWrites);
  }
  var self = horizon; // For clarity below

  var sockets = createSockets();

  // We need to filter out null/undefined handshakes in several places
  var filteredHandshake = sockets.switchMap(function (socket) {
    return socket.handshake;
  }).filter(function (handshake) {
    return handshake != null;
  });

  // Store whatever token we get back from the server when we get a
  // handshake response
  filteredHandshake.subscribe({
    next: function next(handshake) {
      if (authType !== 'unauthenticated') {
        tokenStorage.set(handshake.token);
      }
    },
    error: function error(err) {
      if (/JsonWebTokenError|TokenExpiredError/.test(err.message)) {
        console.error('Horizon: clearing token storage since auth failed');
        tokenStorage.remove();
      }
    }
  });

  self.currentUser = function () {
    return new _ast.UserDataTerm(self, filteredHandshake, self._hzSocket);
  };

  self.disconnect = function () {
    self._hzSocket.complete();
  };

  // Dummy subscription to force it to connect to the
  // server. Optionally provide an error handling function if the
  // socket experiences an error.
  // Note: Users of the Observable interface shouldn't need this
  self.connect = function () {
    var onError = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : function (err) {
      console.error('Received an error: ' + err);
    };

    return sockets.switch().take(1).subscribe({
      error: function error(e) {
        onError(e);
      }
    });
  };

  var status = createStatus();

  // Either subscribe to status updates, or return an observable with
  // the current status and all subsequent status changes.
  self.status = subscribeOrObservable(status);

  // Convenience method for finding out when disconnected
  self.onDisconnected = subscribeOrObservable(status.filter(function (x) {
    return x.type === 'disconnected';
  }));

  // Convenience method for finding out when ready
  self.onReady = subscribeOrObservable(status.filter(function (x) {
    return x.type === 'ready';
  }));

  // Convenience method for finding out when an error occurs
  self.onSocketError = subscribeOrObservable(status.filter(function (x) {
    return x.type === 'error';
  }));

  self.utensils = {
    sendRequest: sendRequest,
    tokenStorage: tokenStorage
  };
  Object.freeze(self.utensils);

  self._authMethods = null;
  self._root = 'http' + (secure ? 's' : '') + '://' + host;
  self._horizonPath = self._root + '/' + path;

  self.authEndpoint = _auth.authEndpoint;
  self.hasAuthToken = tokenStorage.hasAuthToken.bind(tokenStorage);
  self.aggregate = _model.aggregate;
  self.model = _model.model;

  return self;

  // Sends a horizon protocol request to the server, and pulls the data
  // portion of the response out.
  function sendRequest(type, options) {
    // Both remove and removeAll use the type 'remove' in the protocol
    var normalizedType = type === 'removeAll' ? 'remove' : type;
    return sockets.switchMap(function (socket) {
      return socket.hzRequest({ type: normalizedType, options: options }) // send the raw request
      .takeWhile(function (resp) {
        return resp.state !== 'complete';
      });
    });
  }

  function createSockets() {
    var socketsSubject = new _BehaviorSubject.BehaviorSubject();

    socketsSubject.next(new _socket.HorizonSocket({
      url: url,
      handshakeMaker: tokenStorage.handshake.bind(tokenStorage),
      keepalive: keepalive,
      WebSocketCtor: WebSocketCtor,
      websocket: websocket
    }));

    return socketsSubject;
  }

  function createStatus() {
    // Since the underlying socket is going to be swapped out, we need
    // to create a wrapper BehaviorSubject that is subscribed in turn
    // to each subsequent HorizonSocket that is created.
    var statusSubject = new _BehaviorSubject.BehaviorSubject();
    sockets.switchMap(function (socket) {
      return socket.status;
    }).subscribe(statusSubject);
    return statusSubject;
  }
}

function subscribeOrObservable(observable) {
  return function () {
    if (arguments.length > 0) {
      return observable.subscribe.apply(observable, arguments);
    } else {
      return observable;
    }
  };
}

Horizon.Socket = _socket.HorizonSocket;
Horizon.clearAuthTokens = _auth.clearAuthTokens;
//# sourceMappingURL=index.js.map