
// 这个脚本可能在同一页面加载多次
var loaded = loaded || false;
var interval;

chrome.extension.onConnect.addListener(function(port) {

	var $ = document.querySelector.bind(document);

	function authorize() {

		if (loaded) return;
		loaded = true;

		if ($('#allow')) return;

		var pin_elem = $('kbd code');
		if (! pin_elem) return;

		var p = $('#oauth_pin p');

		var pin_code = pin_elem.textContent.trim();
		port.postMessage({
			type: 'authorize',
			pinCode: pin_code
		});

		//pin_elem.style.fontSize = '14px';
		//pin_elem.style.fontWeight = 'normal';
		p.textContent = '正在完成验证, 请稍候..';

		port.onMessage.addListener(function(msg) {
			if (msg.type === 'authorize' && msg.msg === 'success') {
				p.textContent = '验证成功完成! :) 数秒后页面将自动关闭.';
			} else {
				p.innerHTML = '验证失败. 点击 <span id="retry">这里</span> 重试. :( ';
				var retry = document.getElementById('retry');
				retry.addEventListener('click', function() {
					port.postMessage({
						type: 'authorize',
						msg: 'retry'
					});
				}, false);
			}
		});

	}

	clearInterval(interval);
	setInterval(function() {
		if (document.readyState === 'complete') {
			authorize();
			clearInterval(interval);
		}
	}, 50);

});