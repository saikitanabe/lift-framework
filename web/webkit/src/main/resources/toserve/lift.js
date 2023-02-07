(function(window, undefined) {
  "use strict";

  var hasOwnProperty = Object.prototype.hasOwnProperty;

  window.lift = (function() {
    // "private" vars
    var settings,
        ajaxPath = function() { return settings.liftPath + '/ajax'; },
        ajaxQueue = [],
        ajaxInProcess = null,
        ajaxVersion = 0,
        cometPath = function() { return settings.liftPath + '/comet'; },
        doCycleQueueCnt = 0,
        ajaxShowing = false,
        initialized = false,
        pageId = "",
        uriSuffix,
        sessionId = "",
        toWatch = {},
        knownPromises = {};

    // default settings
    settings = {
      /**
        * Contains the Ajax URI path used by Lift to process Ajax requests.
        */
      liftPath: "/lift",
      ajaxRetryCount: 3,
      ajaxPostTimeout: 5000,

      /**
        * By default lift uses a garbage-collection mechanism of removing unused bound functions from LiftSesssion.
        * Setting this to false will disable this mechanism and there will be no Ajax polling requests attempted.
        */
      enableGc: true,

      /**
        * The polling interval for background Ajax requests to prevent functions of being garbage collected.
        * Default value is set to 75 seconds.
        */
      gcPollingInterval: 75000,

      /**
        * The polling interval for background Ajax requests to keep functions to not be garbage collected.
        * This will be applied if the Ajax request will fail. Default value is set to 15 seconds.
        */
      gcFailureRetryTimeout: 15000,
      logError: function(msg) {
        consoleOrAlert(msg);
      },
      ajaxOnFailure: function() {
        window.alert("The server cannot be contacted at this time");
      },
      ajaxOnStart: function() {
        // noop
      },
      ajaxOnEnd: function() {
        // noop
      },
      ajaxOnSessionLost: function() {
        window.location.reload();
      },
      ajaxPost: function(url, data, dataType, onSuccess, onFailure) {
        consoleOrAlert("ajaxPost function must be defined in settings");
        onFailure();
      },
      ajaxGet: function() {
        consoleOrAlert("ajaxGet function must be defined in settings");
      },
      onEvent: function() {
        consoleOrAlert("onEvent function must be defined in settings");
      },
      onDocumentReady: function() {
        consoleOrAlert("onDocumentReady function must be defined in settings");
      },
      getComets: function() {
        consoleOrAlert("getComets function must be defined in settings");
      },
      cometGetTimeout: 140000,
      cometFailureRetryTimeout: 10000,
      cometOnSessionLost: function(contextPath) {
        window.location.href = contextPath || "/";
      },
      cometServer: null,
      cometOnError: function(e) {
        if (window.console && typeof window.console.error === 'function') {
          window.console.error(e.stack || e);
        }
        throw e;
      }
    };

    // "private" funcs
    function consoleOrAlert(msg) {
      if (window.console && typeof window.console.error === 'function') {
        window.console.error(msg);
      }
      else {
        window.alert(msg);
      }
    }

    ////////////////////////////////////////////////
    ///// Ajax /////////////////////////////////////
    ////////////////////////////////////////////////

    function appendToQueue(data, onSuccess, onFailure, responseType, onUploadProgress) {
      var toSend = {
        retryCnt: 0,
        when: (new Date()).getTime(),
        data: data,
        onSuccess: onSuccess,
        onFailure: onFailure,
        responseType: responseType,
        onUploadProgress: onUploadProgress,
        version: ajaxVersion++
      };

      // Make sure we wrap when we hit JS max int.
      var version = ajaxVersion;
      if ((version - (version + 1) !== -1) || (version - (version - 1) !== 1)) {
        ajaxVersion = 0;
      }

      // for adding a func to call
      if (uriSuffix) {
        data += '&' + uriSuffix;
        toSend.data = data;
        uriSuffix = undefined;
      }

      ajaxQueue.push(toSend);
      ajaxQueueSort();

      if (initialized) {
        doCycleQueueCnt++;
        doAjaxCycle();
      }

      return false; // buttons in forms don't trigger the form
    }

    function ajaxQueueSort() {
      ajaxQueue.sort(function (a, b) { return a.when - b.when; });
    }

    function startAjax() {
      ajaxShowing = true;
      settings.ajaxOnStart();
    }

    function endAjax() {
      ajaxShowing = false;
      settings.ajaxOnEnd();
    }

    function testAndShowAjax() {
      if (ajaxShowing && ajaxQueue.length === 0 && ajaxInProcess === null) {
        endAjax();
      }
      else if (!ajaxShowing && (ajaxQueue.length > 0 || ajaxInProcess !== null)) {
        startAjax();
      }
    }

    /*function traverseAndCall(node, func) {
      if (node.nodeType == 1) {
        func(node);
      }
      var i = 0;
      var cn = node.childNodes;

      for (i = 0; i < cn.length; i++) {
        traverseAndCall(cn.item(i), func);
      }
    }*/

    function calcAjaxUrl(url, version) {
      if (settings.enableGc) {
        var replacement = ajaxPath()+'/'+pageId;
        if (version !== null) {
          replacement += ('-'+version.toString(36)) + (ajaxQueue.length > 35 ? 35 : ajaxQueue.length).toString(36);
        }
        return url.replace(ajaxPath(), replacement);
      }
      else {
        return url;
      }
    }

    function registerGC() {
      var data = "__lift__GC=_";

      settings.ajaxPost(
        calcAjaxUrl(ajaxPath()+"/", null),
        data,
        "script",
        successRegisterGC,
        failRegisterGC
      );
    }

    function successRegisterGC() {
      setTimeout(registerGC, settings.gcPollingInterval);
    }

    function failRegisterGC() {
      setTimeout(registerGC, settings.gcFailureRetryTimeout);
    }

    function doCycleIn200() {
      doCycleQueueCnt++;
      setTimeout(doAjaxCycle, 200);
    }

    function doAjaxCycle() {
      if (doCycleQueueCnt > 0) {
        doCycleQueueCnt--;
      }

      var queue = ajaxQueue;
      if (queue.length > 0) {
        var now = (new Date()).getTime();
        if (ajaxInProcess === null && queue[0].when <= now) {
          var aboutToSend = queue.shift();

          ajaxInProcess = aboutToSend;

          var successFunc = function(data) {
            ajaxInProcess = null;
            if (aboutToSend.onSuccess) {
              aboutToSend.onSuccess(data);
            }
            doCycleQueueCnt++;
            doAjaxCycle();
          };

          var failureFunc = function() {
            ajaxInProcess = null;
            var cnt = aboutToSend.retryCnt;

            if (arguments.length === 3 && arguments[1] === 'parsererror') {
              settings.logError('The server call succeeded, but the returned Javascript contains an error: '+arguments[2]);
            }

            if (cnt < settings.ajaxRetryCount) {
              aboutToSend.retryCnt = cnt + 1;
              var now = (new Date()).getTime();
              aboutToSend.when = now + (1000 * Math.pow(2, cnt));
              queue.push(aboutToSend);
              ajaxQueueSort();
            }
            else {
              if (aboutToSend.onFailure) {
                aboutToSend.onFailure();
              }
              else {
                settings.ajaxOnFailure();
              }
            }
            doCycleQueueCnt++;
            doAjaxCycle();
          };

          if (aboutToSend.responseType !== undefined &&
              aboutToSend.responseType !== null &&
              aboutToSend.responseType.toLowerCase() === "json")
          {
            settings.ajaxPost(
              calcAjaxUrl(ajaxPath()+"/", null),
              aboutToSend.data,
              "json",
              successFunc,
              failureFunc,
              aboutToSend.onUploadProgress
            );
          }
          else {
            settings.ajaxPost(
              calcAjaxUrl(ajaxPath()+"/", aboutToSend.version),
              aboutToSend.data,
              "script",
              successFunc,
              failureFunc,
              aboutToSend.onUploadProgress
            );
          }
        }
      }

      testAndShowAjax();
      if (doCycleQueueCnt <= 0) {
        doCycleIn200();
      }
    }

    ////////////////////////////////////////////////
    ///// Comet ////////////////////////////////////
    ////////////////////////////////////////////////

    var currentCometRequest = null,
        // Used to ensure that we can only fire one comet request at a time.
        cometRequestCount = 0;

    // http://stackoverflow.com/questions/4994201/is-object-empty
    function is_empty(obj) {
      // null and undefined are empty
      /* jshint eqnull:true */
      if (obj == null) {
        return true;
      }
      /* jshint eqnull:false */

      // Assume if it has a length property with a non-zero value
      // that that property is correct.
      if (obj.length && obj.length > 0) {
        return false;
      }
      if (obj.length === 0) {
        return true;
      }

      for (var key in obj) {
        if (hasOwnProperty.call(obj, key)) {
          return false;
        }
      }
      // Doesn't handle toString and toValue enumeration bugs in IE < 9
      return true;
    }

    function cometFailureFunc() {
      var requestCount = cometRequestCount;
      setTimeout(function() { cometEntry(requestCount); }, settings.cometFailureRetryTimeout);
    }

    function cometSuccessFunc() {
      var requestCount = cometRequestCount;
      setTimeout(function() { cometEntry(requestCount); }, 100);
    }

    function calcCometPath() {
      var fullPath = cometPath()+ "/" + Math.floor(Math.random() * 100000000000) + "/" + sessionId + "/" + pageId;
      if (settings.cometServer) {
        return settings.cometServer + fullPath;
      } else {
        return fullPath;
      }
    }

    // Forcibly restart the comet cycle; use this, for example, when a
    // new comet has been received.
    function restartComet() {
      if (currentCometRequest) {
        currentCometRequest.abort();
      }

      cometSuccessFunc();
    }

    function cometEntry(requestedCount) {
      var isEmpty = is_empty(toWatch);

      if (!isEmpty && requestedCount === cometRequestCount) {
        uriSuffix = undefined;
        cometRequestCount++;
        currentCometRequest =
          settings.ajaxGet(
            calcCometPath(),
            toWatch,
            cometSuccessFunc,
            cometFailureFunc
          );
      }
    }

    function unlistWatch(watchId) {
      var ret = [];
      for (var item in toWatch) {
        if (item !== watchId) {
          ret.push(item);
        }
      }
      toWatch = ret;
    }

    // Called to register comets in bulk. `cometInfo` should be
    // an object of comet ids associated with comet versions.
    //
    // If startComet is passed and true, restarts the comet request
    // cycle.
    function registerComets(cometInfo, startComet) {
      for (var cometGuid in cometInfo) {
        toWatch[cometGuid] = cometInfo[cometGuid];
      }

      if (startComet) {
        restartComet();
      }
    }

    function rehydrateComets(callback) {
      function onSuccess(html) {
        var iframe = document.createElement("iframe");
        var doc = document.createElement("html");
        iframe.appendChild(doc);
        doc.innerHTML = html;

        toWatch = {};

        var newComets = settings.getComets(doc);
        var oldComets = settings.getComets(document);
        for (var i = 0, n = newComets.length; i < n; i++) {
          var version = newComets[i].getAttribute("data-lift-comet-version");
          var guid = newComets[i].children[0].getAttribute("id");
          toWatch[guid] = version;
          oldComets[i].outerHTML = newComets[i].outerHTML;
        }

        restartComet();
        setTimeout(function() {
          callback();
        });
      }
      function onFailure(err) {
        // Try again??
        settings.logError(err);
      }

      settings.ajaxGet(location.toString(), {}, onSuccess, onFailure, "html");
    }


    ////////////////////////////////////////////////
    ///// Promises /////////////////////////////////
    ////////////////////////////////////////////////
    function randStr() {
      return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    }

    function makeGuid() {
      return randStr() + randStr() + '-' + randStr() + '-' + randStr() + '-' +
             randStr() + '-' + randStr() + randStr() + randStr();
    }

    function removePromise(g) {
      knownPromises[g] = undefined;
    }

    function Promise() {
      // "private" vars
      var self = this,
          _values = [],
          _events = [],
          _failMsg = "",
          _valueFuncs = [],
          _doneFuncs = [],
          _failureFuncs = [],
          _eventFuncs = [],
          _done = false,
          _failed = false;

      // "private" funcs
      function successMsg(value) {
        if (_done || _failed) { return; }
        _values.push(value);
        for (var f in _valueFuncs) {
          _valueFuncs[f](value);
        }
      }

      function failMsg(msg) {
        if (_done || _failed) { return; }
        removePromise(self.guid);
        _failed = true;
        _failMsg = msg;

        for (var f in _failureFuncs) {
          _failureFuncs[f](msg);
        }
      }

      function doneMsg() {
          if (_done || _failed) { return; }
        removePromise(self.guid);
        _done = true;

        for (var f in _doneFuncs) {
          _doneFuncs[f]();
        }
      }

      // public funcs
      self.guid = makeGuid();

      self.processMsg = function(evt) {
        if (_done || _failed) { return; }
        _events.push(evt);
        for (var v in _eventFuncs) {
          try { _eventFuncs[v](evt); }
          catch (e) {
            settings.logError(e);
          }
        }

        /* jshint eqnull:true */
        if (evt.done != null) {
          doneMsg();
        }
        else if (evt.success != null) {
          successMsg(evt.success);
        }
        else if (evt.failure != null) {
          failMsg(evt.failure);
        }
        /* jshint eqnull:false */
      };

      self.then = function(f) {
        _valueFuncs.push(f);

        for (var v in _values) {
          try { f(_values[v]); }
          catch (e) {
            settings.logError(e);
          }
        }

        return self;
      };

      self.fail = function(f) {
        _failureFuncs.push(f);
        if (_failed) {
          try { f(_failMsg); }
          catch (e) {
            settings.logError(e);
          }
        }

        return self;
      };

      self['catch'] = self.fail;

      self.done = function(f) {
        _doneFuncs.push(f);
        if (_done) {
          try { f(); }
          catch (e) {
            settings.logError(e);
          }
        }

        return this;
      };

      self.onEvent = function(f) {
        _eventFuncs.push(f);
        for (var v in _events) {
          try { f(_events[v]); }
          catch (e) {
            settings.logError(e);
          }
        }

        return this;
      };

      self.map = function(f) {
        var ret = new Promise();

        self.done(function() {
          ret.doneMsg();
        });

        self.fail(function (m) {
          ret.failMsg(m);
        });

        self.then(function (v) {
          ret.successMsg(f(v));
        });

        return ret;
      };
    }

    ////////////////////////////////////////////////
    ///// Public Object /////////////////////////////////
    ////////////////////////////////////////////////
    return {
      init: function(options) {
        // override default settings
        this.extend(settings, options);

        var lift = this;
        settings.onDocumentReady(function() {
          var attributes = document.body.attributes,
              cometGuid, cometVersion,
              comets = {};
          for (var i = 0; i < attributes.length; ++i) {
            if (attributes[i].name === 'data-lift-gc') {
              pageId = attributes[i].value;
              if (settings.enableGc) {
                lift.startGc();
              }
            } else if (attributes[i].name.match(/^data-lift-comet-/)) {
              cometGuid = attributes[i].name.substring('data-lift-comet-'.length).toUpperCase();
              cometVersion = parseInt(attributes[i].value, 10);

              comets[cometGuid] = cometVersion;
            } else if (attributes[i].name === 'data-lift-session-id') {
              sessionId = attributes[i].value;
            }
          }

          if (typeof cometGuid !== 'undefined') {
            registerComets(comets, true);
          }

          initialized = true;

          // start the cycle
          doCycleIn200();
        });
      },
      defaultLogError: function(msg) { consoleOrAlert(msg); },
      logError: function() { settings.logError.apply(this, arguments); },
      onEvent: function() { settings.onEvent.apply(this, arguments); },
      ajax: appendToQueue,
      startGc: successRegisterGC,
      ajaxOnSessionLost: function() {
        settings.ajaxOnSessionLost();
      },
      calcAjaxUrl: calcAjaxUrl,
      registerComets: registerComets,
      cometOnSessionLost: function(contextPath) {
        settings.cometOnSessionLost(contextPath);
      },
      rehydrateComets: rehydrateComets,
      cometOnError: function(e) {
        settings.cometOnError(e);
      },
      unlistWatch: unlistWatch,
      setToWatch: function(tw) {
        toWatch = tw;
      },
      setPageId: function(pgId) {
        pageId = pgId;
      },
      getPageId: function() {
        return pageId;
      },
      setUriSuffix: function(suffix) {
        uriSuffix = suffix;
      },
      updWatch: function(id, when) {
        if (toWatch[id] !== undefined) {
          toWatch[id] = when;
        }
      },
      extend: function(obj1, obj2) {
        for (var item in obj2) {
          if (hasOwnProperty.call(obj2, item)) {
            obj1[item] = obj2[item];
          }
        }
      },
      createPromise: function() {
        var promise = new Promise();
        knownPromises[promise.guid] = promise;
        return promise;
      },
      sendEvent: function(g, evt) {
        var p = knownPromises[g];
        if (p) {
          p.processMsg(evt);
        }
      }
    };
  })();

  window.liftJQuery = {
    onEvent: function(elementOrId, eventName, fn) {
      if (typeof elementOrId === 'string') {
        elementOrId = document.getElementById(elementOrId);
      }

      jQuery(elementOrId).on(eventName, fn);
    },
    onDocumentReady: function(fn) {
      jQuery(document).ready(fn);
    },
    ajaxPost: function(url, data, dataType, onSuccess, onFailure) {
      var processData = true,
          contentType = 'application/x-www-form-urlencoded; charset=UTF-8';

      if (typeof data === "object") { // FormData
        processData = false;  // tell jQuery not to process the data
        contentType = false; // tell jQuery not to set contentType
      }

      jQuery.ajax({
        url: url,
        data: data,
        type: "POST",
        dataType: dataType,
        timeout: this.ajaxPostTimeout,
        cache: false,
        success: onSuccess,
        error: onFailure,
        processData: processData,
        contentType: contentType
      });
    },
    ajaxGet: function(url, data, onSuccess, onFailure, dataType) {
      if (!dataType) {
        dataType = "script";
      }

      return jQuery.ajax({
        url: url,
        data: data,
        type: "GET",
        dataType: dataType,
        timeout: this.cometGetTimeout,
        cache: false,
        success: onSuccess,
        error: function(_, status) {
          if (status !== 'abort') {
            return onFailure.apply(this, arguments);
          }
        }
      });
    },
    getComets: function(doc) {
      return jQuery(doc).find("[data-lift-comet-version]").toArray();
    }
  };

  window.liftVanilla = {
    // This and onDocumentReady adapted from https://github.com/dperini/ContentLoaded/blob/master/src/contentloaded.js,
    // as also used (with modifications) in jQuery.
    onEvent: function(elementOrId, eventName, fn) {
      var win = window,
          doc = win.document,
          add = doc.addEventListener ? 'addEventListener' : 'attachEvent',
          pre = doc.addEventListener ? '' : 'on';

      var element = elementOrId;
      if (typeof elementOrId === 'string') {
        element = document.getElementById(elementOrId);
      }

      // This is a Lift addition to allow return false to properly do
      // cross-browser preventDefault/stopPropagation/etc work.
      function normalizeEventReturn(event) {
        var result = fn(event);
        if (result === false) {
          if (typeof event.preventDefault === "function") {
            event.preventDefault();
            event.stopPropagation();
          }
        }

        return result;
      }

      element[add](pre + eventName, normalizeEventReturn, false);
    },
    onDocumentReady: function(fn) {
      var settings = this, done = false, top = true,
      win = window, doc = win.document, root = doc.documentElement,
      pre = doc.addEventListener ? '' : 'on',
      rem = doc.addEventListener ? 'removeEventListener' : 'detachEvent',

      init = function(e) {
        if (e.type === 'readystatechange' && doc.readyState !== 'complete') { return; }
        (e.type === 'load' ? win : doc)[rem](pre + e.type, init, false);
        if (!done && (done = true)) { fn.call(win, e.type || e); }
      },

      poll = function() {
        try { root.doScroll('left'); } catch(e) { setTimeout(poll, 50); return; }
        init('poll');
      };

      if (doc.readyState === 'complete') {
        fn.call(win, 'lazy');
      } else {
        if (doc.createEventObject && root.doScroll) {
          try { top = !win.frameElement; } catch(e) { }
          if (top) { poll(); }
        }
        settings.onEvent(doc, 'DOMContentLoaded', init);
        settings.onEvent(doc, 'readystatechange', init);
        settings.onEvent(win, 'load', init);
      }
    },
    ajaxPost: function(url, data, dataType, onSuccess, onFailure, onUploadProgress) {
      var settings = this;

      var xhr = new XMLHttpRequest();

      if (onUploadProgress) {
        xhr.upload.addEventListener("progress", onUploadProgress, false);
      }

      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) { // Done
          if (xhr.status === 200) {
            if (dataType === "script") {
              try {
                eval(xhr.responseText); // jshint ignore:line
              }
              catch (e) {
                settings.logError('The server call succeeded, but the returned Javascript contains an error: '+e);
              }
              finally {
                onSuccess();
              }
            }
            else if (dataType === "json") {
              var obj = {};
              try {
                obj = JSON.parse(xhr.responseText);
              }
              catch(e) {
                settings.logError('The server call succeeded, but the returned JSON contains an error: '+e);
              }
              finally {
                onSuccess(obj);
              }
            }
            else if (dataType === "html") {
              onSuccess(xhr.responseText);
            }
            else {
              settings.logError("Unknown data type: "+dataType);
            }
          }
          else {
            onFailure();
          }
        }
      };

      xhr.open("POST", url, true);
      xhr.timeout = settings.ajaxPostTimeout;
      xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");

      // set content-type header if the form has been serialized into a string
      if (typeof data === "string") {
        xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
      }

      // These just mimic what jQuery produces
      if (dataType === "script") {
        xhr.setRequestHeader("Accept", "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01");
      }
      else if (dataType === "json") {
        xhr.setRequestHeader("Accept", "application/json, text/javascript, */*; q=0.01");
      }
      xhr.send(data);
    },
    ajaxGet: function(url, data, onSuccess, onFailure) {
      var settings = this;

      // create query string
      var qs = "";
      for (var key in data) {
        if (qs !== "") {
          qs += "&";
        }
        qs += key + "=" + data[key];
      }

      var xhr = new XMLHttpRequest();

      xhr.onreadystatechange = function() {
        if (xhr.readyState === 4) { // Done
          if (xhr.status === 200) {
            try {
              eval(xhr.responseText); // jshint ignore:line
            }
            catch (e) {
              settings.logError('The server call succeeded, but the returned Javascript contains an error: '+e);
            }
            finally {
              onSuccess();
            }
          // done + 0 status = aborted, or at least it's the most
          // straightforward proxy that we have; ready state = 0 is
          // supposed to be aborted, but that's all kinds of not
          // working, unfortunately. jQuery's approach is better,
          // but they have a lot more state tracking to achieve it.
          } else if (xhr.status !== 0) {
            onFailure();
          }
        }
      };

      if (qs !== "") {
        url = url+"?"+qs;
      }

      xhr.open("GET", url, true);
      xhr.timeout = settings.cometGetTimeout;
      xhr.setRequestHeader("Accept", "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01");
      xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
      xhr.send();

      return xhr;
    },
    getComets: function(doc) {
      if(doc.querySelectorAll && typeof doc.querySelectorAll === 'function') {
        var nodes = doc.querySelectorAll("[data-lift-comet-version]");
        return Array.prototype.slice.call(nodes, 0);
      }
      else {
        var divs = doc.getElementsByTagName("div");
        var comets = [];
        for (var i = 0, n = divs.length; i < n; i++) {
          if (divs[i].getAttribute("data-lift-comet-version") !== null) {
            comets.push(divs[i]);
          }
        }
        return comets;
      }
    }
  };

  window.liftUtils = {
    lift_blurIfReturn: function(e) {
      var code;
      if (!e) {
        e = window.event;
      }
      if (e.keyCode) {
        code = e.keyCode;
      }
      else if (e.which) {
        code = e.which;
      }

      var targ;

      if (e.target) {
        targ = e.target;
      }
      else if (e.srcElement) {
        targ = e.srcElement;
      }
      if (targ.nodeType === 3) { // defeat Safari bug
        targ = targ.parentNode;
      }
      if (code === 13) {
        targ.blur();
        return false;
      }
      else {
        return true;
      }
    }
  };

})(this);
