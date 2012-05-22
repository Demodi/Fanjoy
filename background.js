
var content_scripts = [
	'disable.js',
	'content.js'
];
var ce = chrome.extension;
var ct = chrome.tabs;
var root_url = ce.getURL('');
var popup_url = ce.getURL('popup.html');

ce.onMessage = ce.onMessage || ce.onRequest;
ct.sendMessage = ct.sendMessage || ct.sendRequest;


// 配置 Consumer 和系统参数
Ripple.
setupConsumer({
	key: 'c4640921f55d6552ad5d4f7d46813194',
	secret: '912d175718e5af2ea126b64981927a81'
}).
config({
	//dumpLevel: 3
});

function onMessage(msg, sender, sendResponse) {
	var tab = sender.tab;
	if (! tab) return;
	switch (msg.type) {
		case 'close_this_tab':
			closeTab(tab.id);
			break;

		case 'get_settings':
			var code = getSerilizedSettings();
			if (tab.url.indexOf(ce.getURL('')) == 0) {
				ct.sendMessage(tab.id, {
					type: 'do',
					code: code
				});
			} else {
				ct.executeScript(tab.id, {
					code: code
				});
			}
			break;
	}
}

function onConnect(page_port) {
	var tab_id;
	page_port.onMessage.addListener(function(msg) {
		switch (msg.type) {
			// 创建一个分享页面
			case 'create_popup':
				var options = {
					url: 'popup.html',
					width: Share.defaultStyle.winWidth,
					height: Share.defaultStyle.winHeight,
					focused: true,
					type: 'panel',
					left: msg.pos.x,
					top: msg.pos.y
				};
				chrome.windows.create(options, function(win) {
					tab_id = win.tabs[0].id;
					ce.onConnect.addListener(function onPopupConnected(popup_port) {
						if (! popup_port.sender || popup_port.sender.tab.id !== tab_id) return;
						page_port.postMessage({
							type: 'popup_created'
						});
						ce.onConnect.removeListener(onPopupConnected);
					});
				});
				break;

			default:
				ct.sendMessage(tab_id, msg);
				break;
		}
	});
}

function disableAll() {
	initializeContentScripts(['disable.js']);
}

function applySettings() {
	executeScript(getSerilizedSettings());
}

function updateDetails(mode) {
	var user = Ripple(Share.accessToken);
	var verify = user.verify().next(function(details) {
		lscache.set('account_details', details);
		Share.account = details;
	});
	if (mode) {
		// 延时重试
		verify.
		error(function() {
			setTimeout(function() {
				updateDetails(mode);
			}, 60000);
		});
	}
	return verify;
}

function setupContextMenus() {
	for (var type in onContextmenus) { (function(type) {
		chrome.contextMenus.create({
			title: onContextmenus[type][0],
			onclick: function(info, tab) {
				var code = onContextmenus[type][1].call(this, info, tab);
				if (tab.url.indexOf(root_url) == 0) {
					if (tab.url != root_url + 'introduction.html') return;
					ct.sendMessage(tab.id, {
						type: 'do',
						code: code
					});
				} else {
					ct.executeScript(tab.id, {
						code: code
					});
				}
			},
			contexts: [type]
		});
	})(type) }
}

function validTab(tab) {
	if (! tab.url) return false;
	return tab.url.indexOf('http://') == 0 ||
		tab.url.indexOf('https://') == 0 ||
		tab.url.indexOf('file:///') == 0 || false;
}

function closeTab(id) {
	ct.remove(id);
}

function closeWindow(id) {
	chrome.windows.remove(id);
}

function closeAllPopup() {
	ct.query({
		url: popup_url
	}, function(tabs) {
		while (tabs.length) {
			closeTab(tabs.shift().id);
		}
	});
}

function broadcast(callback) {
	ct.query({}, function(tabs) {
		tabs.forEach(function(tab) {
			if (validTab(tab)) {
				callback(tab.id);
			}
		});
	});
}

function load() {
	if (Share.loaded) return;
	Share.loaded = true;
	Share.user = Ripple(Share.accessToken);
	ce.onConnect.addListener(onConnect);
	ce.onMessage.addListener(onMessage);
	setupContextMenus();
	applySettings();
}

function unload() {
	if (! Share.loaded) return;
	Share.loaded = false;
	Share.user = null;
	ce.onConnect.removeListener(onConnect);
	ce.onMessage.removeListener(onMessage);
	chrome.contextMenus.removeAll();
	disableAll();
}

function initialize() {

	if (Share.accessToken) {
		// 更新账户信息
		updateDetails().
		next(function() {
			// 成功
			load();
		}).
		error(function(event) {
			if (event.status) {
				// access token 无效
				reset();
			} else {
				// 网络错误
				if (Share.account) {
					// 如果本地存在缓存的账户信息,
					// 则先使用缓存, 等一会再重试
					load();
					setTimeout(function() {
						updateDetails(true);
					}, 60000);
				} else {
					// 如果不存在, 则稍后再重试
					setTimeout(initialize, 60000);
				}
			}
		});

		return;
	}

	var tab_id, tab_port;
	Ripple.authorize.withPINCode(function(auth_url) {
		var options = {
			url: auth_url,
			selected: true
		};
		var deferred = Deferred();

		// 打开验证页面
		ct.create(options, function(tab) {

			ct.onUpdated.addListener(function onUpdated(id, info) {
				// 等待用户点击 '授权' 后跳转至 PIN Code 页面
				if (id !== tab.id) return;
				tab_id = id;

				// 继续验证操作
				ct.executeScript(id, {
					file: 'authorize.js'
				}, function() {
					// 等待页面传送 PIN Code
					var port = ct.connect(id);
					port.onMessage.addListener(function listenForPINCode(pin_code) {
						tab_port = port;
						// 如果页面端没有拿到 PIN Code, 会传送 'rejected' 消息过来
						deferred[pin_code == 'rejected' ? 'fail' : 'call'](pin_code);

						ct.onUpdated.removeListener(onUpdated);
						tab_port.onMessage.removeListener(listenForPINCode);
					});
				});

				ct.insertCSS(id, {
					code: '#retry { text-decoration: underline; } #retry:hover { cursor: pointer; }'
				});
			});

		});

		// 返回 Deferred, 当拿到 PIN Code 后会继续后面的操作
		return deferred;
	}).
	next(function(token) {
		// 成功拿到 access token
		tab_port.postMessage('success');

		// 把 access token 缓存下来并重启程序
		lscache.set('access_token', token);
		Share.accessToken = token;
		initialize();

		// 首次运行且完成验证后, 打开入门教程
		if (lscache.get('is_first_run') !== false) {
			window.open('introduction.html');
		}
		setTimeout(function() {
			closeTab(tab_id);
		}, 5000);
		lscache.set('is_first_run', false);
	}).
	error(function(error) {
		if (Ripple.getConfig('dumpLevel') > 0) {
			console.log(error);
		}
		if (tab_port) {
			// 打开了验证页面, 却没有完成验证
			tab_port.postMessage('failure');
			tab_port.onMessage.addListener(function(msg) {
				// 等待用户点击 '重试'
				if (msg === 'retry') {
					closeTab(tab_id);
					initialize();
				}
			});
		} else {
			// 可能由于网络错误, 导致验证地址没有成功获取
			setTimeout(initialize, 60000);
		}
	});

}

// 清理所有与当前用户有关的数据, 恢复到未加载状态
function reset() {
	Share.unload();
	Share.accessToken = Share.account = Share.user = null;
	lscache.remove('access_token');
	lscache.remove('account_details');
	initialize();
}

function initializeContentScripts(files) {
	broadcast(function(tab_id) {
		loadContentScripts(tab_id, files)
	});
}

function loadContentScripts(tab_id, files) {
	// 异步加载多个 content script
	(function load(i) {
		ct.executeScript(tab_id, {
			file: files[i++]
		}, function() {
			if (files[i]) load(i);
		});
	})(0)
}

function executeScript(code) {
	broadcast(function(tab_id) {
		ct.executeScript(tab_id, { code: code });
	});
}

function getSerilizedSettings() {
	return 'var settings = ' + JSON.stringify(settings.current) +';';
}

// 上下文菜单细节
var onContextmenus = {
	selection: ['有饭同享: %s', function(info, tab) {
		return 'shareSelection(true);';
	}],
	image: ['有饭同享: 分享图片', function(info, tab) {
		return 'shareImage("' + info.srcUrl + '");';
	}],
	link: ['有饭同享: 分享链接', function(info, tab) {
		return 'shareLink("' + info.linkUrl + '");';
	}],
};
onContextmenus.page = [
	'有饭同享: 分享页面',
	onContextmenus.selection[1]
];

var settings = {
	default: {
		enableGesture: true,
		enableMidButton: false,
		ctrlKey: false,
		templates: {
			'selection': '$page_tit $page_url $sel',
			'link': '$link_tit|$link_desc $link_url $sel',
			'image': '#$img_desc|$page_tit#'
		}
	},
	keys: ['page_tit', 'page_url', 'sel', 'img_desc', 'img_url', 'link_url', 'link_desc', 'link_tit'],
	current: {}
};

var Share = this.Share = {
	defaultStyle: {
		winWidth: 300,
		winHeight: 163,
		minContentHeight: 45,
		maxContentHeight: 135
	},
	load: load,
	unload: unload,
	setupContextMenus: setupContextMenus,
	closeAllPopup: closeAllPopup,
	initialize: initialize,
	reset: reset,
	loaded: false,
	getSettings: function() {
		if (! lscache.get('settings')) {
			this.setSettings(settings.default);
		}
		return lscache.get('settings');
	},
	setSettings: function(object) {
		Ripple.helpers.extend(true, settings.current, object);
		lscache.set('settings', settings.current);
		applySettings();
	},
	showLogin: function() {
		ct.create({
			url: 'http://fanfou.com/login',
			selected: true
		});
	},
	account: lscache.get('account_details'), // 当前账号的数据, 如昵称头像等
	accessToken: lscache.get('access_token'), // 缓存的 access token, 与饭否服务器联络的凭证
	user: null // 一个 Ripple 实例, 提供所有 API 接口
};

settings.current = Share.getSettings();

initialize();
initializeContentScripts(content_scripts);