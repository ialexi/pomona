// ==========================================================================
// Project:   Pomona
// Copyright: ©2009 TPSi and Alex Iskander.
// ==========================================================================
/*globals Pomona */

/** @namespace

	@extends SC.Object
*/
Pomona = SC.Object.create(
	/** @scope Pomona.prototype */ {
	
	NAMESPACE: 'Pomona',
	VERSION: '0.1.0',
	
	/**
		A Firenze is a single connection between the server and the client.
		
		Currently, Firenzes are only one-way: server to client. To connect the client
		to paths on the server, you must actually call a connect method on a separate server-side
		application.
	*/
	Firenze: SC.Object.extend({
		/**
			host: The host which hosts the comet server. Really needs to be the
				same host as hosts the app, due to security restrictions.
				
				If set to "", paths will be relative from /.
		*/
		host: document.domain,
		
		/**
			prefix: The prefix for urls on that server. While the real server is
			always at /, if you are proxying, this can be useful.
		*/
		prefix: "comet/",
		
		/**
			The port of the Firenze instance on the Dobby server.
		*/
		port: 4020,
		
		/**
			The protocol abbreviation to prefix the path with. Maybe you want https?
		*/
		protocol: "http",
		
		/**
			Whether to un-magicify document.domain by setting it to itself, allowing
			cross-port traffic (in theory).
		*/
		crossPort: YES,
		
		/**
			The URL to call to connect Pomona with Dobby.
			
			The string will be formatted, replacing a single variable with the UID.
			Supplied to the path in post data will be the paths to connect.
		*/
		connectUrl: "/server/connect/%@",
		
		/**
			The URL to call to disconnect Pomona from Dobby.
			
			Supplied to the path in post data will be the paths to disconnect.
		*/
		disconnectUrl: "/server/disconnect/%@",
		
		init: function() {
			if (this.crossPort) document.domain = document.domain;
			
			// create attachment collection
			this._attachments = {}; // a collection of specialized set objects
			// that use a specialized hash function
			
			this._reconnectWith = "";
			this._uid = "";
			
			// begin the comet loop
			this._beginNextRequest();
		},
		
		_beginNextRequest: function() {
			// make sure we clear any timer
			this.timer = undefined;
			
			// get pre part, if any (proxied requests have no need)
			var pre = "";
			if (this.host.length !== 0) pre = this.protocol + "://" + this.host + ":" + this.port;
			
			// get url
			var url = pre + "/" + this.prefix + this._reconnectWith;
			
			// make request
			SC.Request.getUrl(url)
				.json().notify(this, "_receive").send();
		},
		
		_receive: function(response) {
			// get response body, if possible. Default path=failure.
			var body = response.get("body");
			if (body) {
				// get the reconnection thingy. We don't care if we were disconnected. We'll
				// try try again.
				this._reconnectWith = body.reconnectWith;
				
				// if reconnect with, we need to get uid so connect calls can be made as needed.
				if (this._reconnectWith && this._reconnectWith.trim().length > 0) {
					var uid = this._reconnectWith.split("/")[0];
					
					// only reconnect if we actually disconnected.
					if (uid != this._uid) {
						this._uid = uid;
						this._establishConnections();
					}
				} else this._uid = "";
				
				// handle updates
				var updates = body.updates; // should at least exist.
				if (updates) { // so, if it does
					var i = 0, len = updates.length; // performance performance performance
					for (i = 0; i < len; i++) {
						// process update
						this.update(updates[i].path, updates[i].message);
					}
					
					// and start all over again.
					this._beginNextRequest();
					
					// all is well
					return;
				}
			}
			
			// not okay, so we wait for a sec, then try again
			if (this.timer) this.timer.invalidate();
			this.timer = SC.Timer.schedule({
				interval: 1000,
				target: this,
				action: "_beginNextRequest"
			});
		},
		
		_establishConnections: function() {
			var attachments = this._attachments;
			var connect = [];
			// loop through attachments and add data to connect
			for (var i in attachments) {
				connect.push(i);
			}
			
			// send connect signal
			this._connect(connect);
		},
		
		_connect: function(connections) {
			// get url
			var curl = this.connectUrl;
			var url = curl.fmt(this._uid);
			
			// send
			SC.Request.postUrl(url).json().notify(this, "_didConnect", connections)
				.send(connections);
		},
		
		_disconnect: function(connections) {
			// get url
			var dcurl = this.disconnectUrl;
			var url = dcurl.fmt(this._uid);
			
			// send
			SC.Request.postUrl(url).json().notify(this, "_didDisconnect", connections)
				.send(connections);
		},
		
		_didConnect: function(response, connections) {
			// what do I do here?
		},
		
		update: function(path, data) {
			if (!this._attachments[path]) return; // not sure why we got this...
			
			var item = this._attachments[path].first;
			while (item) {
				if (SC.typeOf(item.action) == SC.T_STRING) {
					item.target[item.action].call(item.target, path, data);
				} else {
					item.action.call(item.target, path, data);	
				}
				
				item = item.next;
			}
		},
		
		_hashFor: function(target, action) {
			var hash = SC.guidFor(target);
			if (SC.typeOf(action) == SC.T_STRING) {
				hash += "::" + action;
			} else hash += SC.guidFor(action);
			return hash;
		},
		
		_attach: function(path) {
			// todo: add  delay before calling _connect so we can bundle connect requests...
			if (this._uid && this._uid !== "") {
				console.error("CONNECT!");
				this._connect([path]);
			}
			
			// add to attachments
			this._attachments[path] = { "first": null, set: {}, length: 0 };
		},
		
		_detach: function(path) {
			if (this._uid && this._uid !== "") {
				this._disconnect([path]);
			}
			
			delete this._attachments[path];
		},
		
		connect: function(path, target, action) {
			var hash = this._hashFor(target, action);
			// create set if needed
			if (!this._attachments[path]) {
				this._attach(path);
			}
			
			// get set
			var set = this._attachments[path];
			
			// don't allow duplicates
			if (set.set[hash]) return;
			
			// continue
			var first = set.first;
			
			// create a handle
			var handle = { "target": target, "action": action, "previous": null, "next": set.first };
			
			// insert into set
			if (set.first) set.first.previous = handle;
			set.first = handle;
			set.length += 1;
			set.set[hash] = handle;
		},
		
		disconnect: function(path, target, action) {
			var hash = this._hashFor(target, action);
			
			// if a set doesn't exist, we have nothing to remove
			if (!this._attachments[path]) return;
			
			// get set
			var set = this._attachments[path];
			var handle = set.set[hash];
			
			// bitshifting :)
			if (set.first === handle) set.first = handle.next; // null if needed
			if (handle.previous) handle.previous.next = handle.next;
			if (handle.next) handle.next.previous = handle.previous;
			delete set.set[hash];
			
			// disconnect if needed, and done!
			set.length -= 1;
			if (set.length <= 0) {
				// remove set
				this._detach(path);
			}
		}
	})
}) ;
