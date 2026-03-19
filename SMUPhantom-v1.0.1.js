// ==UserScript==
// @name         SMUPhantom
// @namespace    https://github.com/HarenaGodz/SMUPhantom
// @version      1.0.1
// @description  为西南民族大学课堂考勤系统提供虚拟定位和地图选点功能
// @author       Harena
// @license      AGPL-3.0-or-later
// @match        https://ktkq.swun.edu.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';
    
    console.log('[KTKQ] 脚本开始运行 v1.0.1');
    console.log('[KTKQ] 高德地图API密钥已配置: 7bf909742712a9eca7c5e18efa431f9a');
    
    // ── 早期拦截（document-start 阶段）──
    // 在页面任何 JS 执行前，若上次已启用虚拟定位，立即锁定 geolocation
    // 防止页面脚本在初始化时缓存到原始方法
    (function earlyIntercept() {
        try {
            if (typeof GM_getValue !== 'function') return;
            const raw = GM_getValue('ktkq-location-config', null);
            if (!raw) return;
            const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!cfg || !cfg.virtualEnabled) return;
            const lat = parseFloat(cfg.latitude), lng = parseFloat(cfg.longitude), acc = cfg.accuracy || 10;
            if (isNaN(lat) || isNaN(lng)) return;
            const makePos = () => ({
                coords: { latitude: lat, longitude: lng, accuracy: acc,
                          altitude: null, altitudeAccuracy: null, heading: null, speed: null },
                timestamp: Date.now()
            });
            const fakeGet   = (s, e) => { try { if (s) s(makePos()); } catch (ex) { if (e) e({ code: 2, message: ex.message }); } };
            const fakeWatch = (s, e) => { try { if (s) s(makePos()); return 0; } catch (ex) { if (e) e({ code: 2, message: ex.message }); return -1; } };
            // 注入到 navigator.geolocation 实例和 prototype
            const targets = [navigator.geolocation];
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow.navigator.geolocation)
                targets.push(unsafeWindow.navigator.geolocation);
            targets.forEach(geo => {
                if (!geo) return;
                geo.getCurrentPosition = fakeGet;
                geo.watchPosition      = fakeWatch;
                try {
                    const p = Object.getPrototypeOf(geo);
                    Object.defineProperty(p, 'getCurrentPosition', { configurable: true, writable: true, value: fakeGet });
                    Object.defineProperty(p, 'watchPosition',      { configurable: true, writable: true, value: fakeWatch });
                } catch (_) {}
            });
            console.log('[KTKQ] 早期拦截注入成功，坐标:', lat, lng);
        } catch (e) {
            console.warn('[KTKQ] 早期拦截失败:', e.message);
        }
    })();
    
    // ==================== 配置管理 ====================
    const CONFIG_KEY = 'ktkq-location-config';
    
    const defaultConfig = {
        latitude: '30.565641',  // 西南民族大学航空港校区默认纬度
        longitude: '103.967577', // 西南民族大学航空港校区默认经度
        accuracy: 10,
        virtualEnabled: false,
        presets: [],
        history: [],  // 新增：历史记录
        nightMode: false,
        btnPosition: { left: null, top: null, right: 20, bottom: 80 },
        disclaimerAccepted: false,  // 新增：免责声明接受状态
        betaCodeVerified: false  // 新增：内测码验证状态
    };
    
    // 内测码
    const BETA_CODE = 'xy7355608';
    
    function getConfig() {
        try {
            const config = GM_getValue(CONFIG_KEY, defaultConfig);
            return { ...defaultConfig, ...config };
        } catch (e) {
            console.error('[KTKQ] 读取配置失败:', e);
            return defaultConfig;
        }
    }
    
    function saveConfig(config) {
        try {
            GM_setValue(CONFIG_KEY, config);
            console.log('[KTKQ] 配置已保存');
        } catch (e) {
            console.error('[KTKQ] 保存配置失败:', e);
        }
    }
    
    // ==================== 坐标转换 ====================
    const CoordTransform = {
        PI: 3.1415926535897932384626,
        a: 6378245.0,
        ee: 0.00669342162296594323,

        
        transformLat(lng, lat) {
            let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
            ret += (20.0 * Math.sin(6.0 * lng * this.PI) + 20.0 * Math.sin(2.0 * lng * this.PI)) * 2.0 / 3.0;
            ret += (20.0 * Math.sin(lat * this.PI) + 40.0 * Math.sin(lat / 3.0 * this.PI)) * 2.0 / 3.0;
            ret += (160.0 * Math.sin(lat / 12.0 * this.PI) + 320 * Math.sin(lat * this.PI / 30.0)) * 2.0 / 3.0;
            return ret;
        },
        
        transformLng(lng, lat) {
            let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
            ret += (20.0 * Math.sin(6.0 * lng * this.PI) + 20.0 * Math.sin(2.0 * lng * this.PI)) * 2.0 / 3.0;
            ret += (20.0 * Math.sin(lng * this.PI) + 40.0 * Math.sin(lng / 3.0 * this.PI)) * 2.0 / 3.0;
            ret += (150.0 * Math.sin(lng / 12.0 * this.PI) + 300.0 * Math.sin(lng / 30.0 * this.PI)) * 2.0 / 3.0;
            return ret;
        },
        
        outOfChina(lng, lat) {
            return (lng < 72.004 || lng > 137.8347) || (lat < 0.8293 || lat > 55.8271);
        },
        
        wgs84ToGcj02(wgsLng, wgsLat) {
            if (this.outOfChina(wgsLng, wgsLat)) return { lng: wgsLng, lat: wgsLat };
            let dLat = this.transformLat(wgsLng - 105.0, wgsLat - 35.0);
            let dLng = this.transformLng(wgsLng - 105.0, wgsLat - 35.0);
            const radLat = wgsLat / 180.0 * this.PI;
            let magic = Math.sin(radLat);
            magic = 1 - this.ee * magic * magic;
            const sqrtMagic = Math.sqrt(magic);
            dLat = (dLat * 180.0) / ((this.a * (1 - this.ee)) / (magic * sqrtMagic) * this.PI);
            dLng = (dLng * 180.0) / (this.a / sqrtMagic * Math.cos(radLat) * this.PI);
            return { lng: wgsLng + dLng, lat: wgsLat + dLat };
        },
        
        gcj02ToWgs84(gcjLng, gcjLat) {
            if (this.outOfChina(gcjLng, gcjLat)) return { lng: gcjLng, lat: gcjLat };
            let dLat = this.transformLat(gcjLng - 105.0, gcjLat - 35.0);
            let dLng = this.transformLng(gcjLng - 105.0, gcjLat - 35.0);
            const radLat = gcjLat / 180.0 * this.PI;
            let magic = Math.sin(radLat);
            magic = 1 - this.ee * magic * magic;
            const sqrtMagic = Math.sqrt(magic);
            dLat = (dLat * 180.0) / ((this.a * (1 - this.ee)) / (magic * sqrtMagic) * this.PI);
            dLng = (dLng * 180.0) / (this.a / sqrtMagic * Math.cos(radLat) * this.PI);
            const mgLat = gcjLat + dLat;
            const mgLng = gcjLng + dLng;
            return { lng: gcjLng * 2 - mgLng, lat: gcjLat * 2 - mgLat };
        }
    };

    
    // ==================== 主类 ====================
    class LocationAssistant {
        constructor() {
            console.log('[KTKQ] 初始化 LocationAssistant');
            this.config = getConfig();
            // 在页面任何脚本运行之前，从 Geolocation.prototype 上保存原始方法
            // 优先从 unsafeWindow 获取，确保拿到的是浏览器原生实现
            const _geo = (typeof unsafeWindow !== 'undefined' && unsafeWindow.navigator.geolocation)
                ? unsafeWindow.navigator.geolocation
                : navigator.geolocation;
            const _proto = Object.getPrototypeOf(_geo);
            this.originalGetCurrentPosition = (_proto.getCurrentPosition || _geo.getCurrentPosition).bind(_geo);
            this.originalWatchPosition      = (_proto.watchPosition      || _geo.watchPosition).bind(_geo);
            this.originalClearWatch         = (_proto.clearWatch         || _geo.clearWatch).bind(_geo);
            this._watchIds = [];   // 记录虚拟 watchId，用于 clearWatch 拦截
            this.isDragging = false;
            this.justDragged = false;
            this.menuVisible = false;
            this.isMinimized = this.config.isMinimized || false;
            this.isHidden = false;
            this.isMobile = this.detectMobile();
            this.init();
        }
        
        detectMobile() {
            const ua = navigator.userAgent;
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
            const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
            const isSmallScreen = window.innerWidth <= 768;
            return isMobile || (isTouch && isSmallScreen);
        }
        
        init() {
            console.log('[KTKQ] 开始初始化');
            this.injectCSS();
            this.createUI();
            this.bindEvents();
            this.bindHotkeys();
            
            // 渲染预设列表和快速预设
            this.renderPresets();
            this.renderHistory();
            
            // 应用最小化状态
            if (this.isMinimized) {
                this.button.classList.add('minimized');
            }
            
            // 检查是否首次使用，显示内测码验证和免责声明
            if (!this.config.betaCodeVerified || !this.config.disclaimerAccepted) {
                console.log('[KTKQ] 首次使用，将显示验证流程');
                setTimeout(() => {
                    if (!this.config.betaCodeVerified) {
                        this.showBetaCodeModal();
                    } else if (!this.config.disclaimerAccepted) {
                        this.showDisclaimerModal();
                    }
                }, 500);
                // 不启用任何功能，等待用户验证和同意
                return;
            }
            
            // 只有同意免责声明后才启用功能
            if (this.config.virtualEnabled && this.config.latitude && this.config.longitude) {
                this.startVirtual();
            }
            
            if (this.config.nightMode) {
                this.applyNightMode();
            }
            
            // 延迟自动检测网页定位状态
            setTimeout(() => {
                if (this.config.betaCodeVerified && this.config.disclaimerAccepted) {
                    this.detectPageLocation();
                }
            }, 1000);
            
            console.log('[KTKQ] 初始化完成');
            const welcomeMsg = this.isMobile 
                ? 'SMUPhantom 已就绪 (长按按钮 | 三击恢复)' 
                : 'SMUPhantom 已就绪 (Ctrl+H 隐藏, Ctrl+M 缩小)';
            this.showNotification(welcomeMsg, 'success');
        }
        
        createUI() {
            console.log('[KTKQ] 创建UI');
            console.log('[KTKQ] document.body:', document.body);
            console.log('[KTKQ] document.readyState:', document.readyState);
            
            if (!document.body) {
                console.error('[KTKQ] document.body 不存在，延迟创建UI');
                setTimeout(() => this.createUI(), 100);
                return;
            }
            
            const container = document.createElement('div');
            container.id = 'ktkq-container';
            container.innerHTML = this.getHTML();
            document.body.appendChild(container);
            
            console.log('[KTKQ] 容器已添加到body');
            
            this.button = document.getElementById('ktkq-btn');
            this.menu = document.getElementById('ktkq-menu');
            
            console.log('[KTKQ] button元素:', this.button);
            console.log('[KTKQ] menu元素:', this.menu);
            
            if (!this.button || !this.menu) {
                console.error('[KTKQ] UI元素创建失败');
                console.error('[KTKQ] HTML内容:', container.innerHTML.substring(0, 200));
                return;
            }
            
            console.log('[KTKQ] UI元素创建成功');
            this.setBtnPosition();
        }
        
        setBtnPosition() {
            const pos = this.config.btnPosition;
            if (pos.left !== null) {
                this.button.style.left = pos.left + 'px';
                this.button.style.right = 'auto';
            } else {
                this.button.style.right = pos.right + 'px';
                this.button.style.left = 'auto';
            }
            if (pos.top !== null) {
                this.button.style.top = pos.top + 'px';
                this.button.style.bottom = 'auto';
            } else {
                this.button.style.bottom = pos.bottom + 'px';
                this.button.style.top = 'auto';
            }
            console.log('[KTKQ] 按钮位置已设置:', pos);
        }

        
        bindEvents() {
            // 按钮点击
            this.button.addEventListener('click', () => {
                if (this.justDragged) {
                    this.justDragged = false;
                    return;
                }
                
                // 检查是否已验证内测码和同意免责声明
                if (!this.config.betaCodeVerified) {
                    this.showBetaCodeModal();
                    return;
                }
                if (!this.config.disclaimerAccepted) {
                    this.showDisclaimerModal();
                    return;
                }
                
                this.toggleMenu();
            });
            
            // 拖动
            this.bindDrag();
            
            // 关闭菜单
            document.getElementById('ktkq-close').addEventListener('click', () => this.toggleMenu());
            
            // 标签切换
            document.querySelectorAll('.ktkq-tab').forEach(tab => {
                tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
            });
            
            // 虚拟定位开关
            document.getElementById('ktkq-virtual-switch').addEventListener('click', () => this.toggleVirtual());
            
            // 获取位置
            document.getElementById('ktkq-get-location').addEventListener('click', () => this.getCurrentLocation());
            
            // 地图选点
            document.getElementById('ktkq-map-picker').addEventListener('click', () => this.openMapPicker());
            
            // 应用坐标
            document.getElementById('ktkq-apply').addEventListener('click', () => this.applyCoords());
            
            // 新增：刷新定位状态
            const refreshStatusBtn = document.getElementById('ktkq-refresh-status');
            if (refreshStatusBtn) {
                refreshStatusBtn.addEventListener('click', () => this.refreshLocationStatus());
            }
            
            // 新增：检测网页定位
            const detectLocationBtn = document.getElementById('ktkq-detect-location');
            if (detectLocationBtn) {
                detectLocationBtn.addEventListener('click', () => this.detectPageLocation());
            }
            
            // 自动刷新切换
            const autoRefreshBtn = document.getElementById('ktkq-auto-refresh-toggle');
            if (autoRefreshBtn) {
                autoRefreshBtn.addEventListener('click', () => this.toggleAutoRefresh());
            }
            
            // 状态页复制坐标
            const statusCopyBtn = document.getElementById('ktkq-status-copy');
            if (statusCopyBtn) {
                statusCopyBtn.addEventListener('click', () => {
                    const lat = document.getElementById('ktkq-page-lat').textContent;
                    const lng = document.getElementById('ktkq-page-lng').textContent;
                    if (lat === '--' || lng === '--') { this.showNotification('请先检测定位', 'warning'); return; }
                    const text = `${lat}, ${lng}`;
                    navigator.clipboard ? navigator.clipboard.writeText(text).then(() => this.showNotification('✅ 坐标已复制', 'success')) : this.fallbackCopyText(text);
                });
            }
            
            // 状态页"使用坐标"填入定位面板
            const statusUseBtn = document.getElementById('ktkq-status-use');
            if (statusUseBtn) {
                statusUseBtn.addEventListener('click', () => {
                    if (this._lastDetectedLat == null) { this.showNotification('请先检测定位', 'warning'); return; }
                    document.getElementById('ktkq-lat').value = this._lastDetectedLat.toFixed(6);
                    document.getElementById('ktkq-lng').value = this._lastDetectedLng.toFixed(6);
                    this.config.latitude = this._lastDetectedLat.toFixed(6);
                    this.config.longitude = this._lastDetectedLng.toFixed(6);
                    saveConfig(this.config);
                    this.showNotification('✅ 坐标已填入定位面板', 'success');
                    this.switchTab('location');
                });
            }
            
            // 新增：复制坐标
            const copyBtn = document.getElementById('ktkq-copy-coords');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => this.copyCoords());
            }
            
            // 保存预设
            document.getElementById('ktkq-save-preset').addEventListener('click', () => this.savePreset());
            
            // 新增预设折叠按钮
            const addToggleBtn = document.getElementById('ktkq-add-preset-toggle');
            if (addToggleBtn) {
                addToggleBtn.addEventListener('click', () => {
                    const body = document.getElementById('ktkq-add-preset-body');
                    const arrow = document.getElementById('ktkq-add-toggle-arrow');
                    const isOpen = body.style.display !== 'none';
                    body.style.display = isOpen ? 'none' : 'block';
                    arrow.textContent = isOpen ? '▼' : '▲';
                    addToggleBtn.classList.toggle('open', !isOpen);
                });
            }
            
            // 预设搜索
            const searchInput = document.getElementById('ktkq-preset-search');
            if (searchInput) {
                searchInput.addEventListener('input', () => this.renderPresets());
            }
            
            // 预设经纬度输入框同步
            const presetLatInput = document.getElementById('ktkq-preset-lat');
            const presetLngInput = document.getElementById('ktkq-preset-lng');
            const mainLatInput = document.getElementById('ktkq-lat');
            const mainLngInput = document.getElementById('ktkq-lng');
            
            if (presetLatInput && mainLatInput) {
                // 从定位页面同步到预设页面
                mainLatInput.addEventListener('input', () => {
                    presetLatInput.value = mainLatInput.value;
                });
                // 从预设页面同步到定位页面
                presetLatInput.addEventListener('input', () => {
                    mainLatInput.value = presetLatInput.value;
                    this.config.latitude = presetLatInput.value;
                    saveConfig(this.config);
                });
            }
            
            if (presetLngInput && mainLngInput) {
                // 从定位页面同步到预设页面
                mainLngInput.addEventListener('input', () => {
                    presetLngInput.value = mainLngInput.value;
                });
                // 从预设页面同步到定位页面
                presetLngInput.addEventListener('input', () => {
                    mainLngInput.value = presetLngInput.value;
                    this.config.longitude = presetLngInput.value;
                    saveConfig(this.config);
                });
            }
            
            // 导入导出按钮（使用事件委托）
            const presetPanel = document.getElementById('ktkq-panel-presets');
            if (presetPanel) {
                presetPanel.addEventListener('click', (e) => {
                    const target = e.target.closest('[data-action]');
                    if (!target) return;
                    
                    const action = target.dataset.action;
                    if (action === 'export') {
                        this.exportPresets();
                    } else if (action === 'import') {
                        this.importPresets();
                    }
                });
            }
            
            // 预设页面的地图选点
            const presetMapPickerBtn = document.getElementById('ktkq-preset-map-picker');
            if (presetMapPickerBtn) {
                presetMapPickerBtn.addEventListener('click', () => this.openPresetMapPicker());
            }
            
            // 预设页面的获取位置
            const presetGetLocationBtn = document.getElementById('ktkq-preset-get-location');
            if (presetGetLocationBtn) {
                presetGetLocationBtn.addEventListener('click', () => this.getPresetLocation());
            }
            
            // 夜间模式
            document.getElementById('ktkq-night-switch').addEventListener('click', () => this.toggleNightMode());
            
            // 精度调整
            document.getElementById('ktkq-accuracy').addEventListener('input', (e) => {
                this.config.accuracy = parseInt(e.target.value);
                document.getElementById('ktkq-accuracy-val').textContent = e.target.value;
                saveConfig(this.config);
            });
            
            // 恢复初始状态
            document.getElementById('ktkq-reset-script').addEventListener('click', () => this.showResetConfirmation());

            // 状态页虚拟定位快速开关
            const statusVirtualSwitch = document.getElementById('ktkq-status-virtual-switch');
            if (statusVirtualSwitch) {
                statusVirtualSwitch.addEventListener('click', () => {
                    this.toggleVirtual();
                    // 同步状态页卡片UI
                    this._syncStatusVirtualCard();
                });
            }

            // 清空历史记录
            const clearHistoryBtn = document.getElementById('ktkq-clear-history');
            if (clearHistoryBtn) {
                clearHistoryBtn.addEventListener('click', () => {
                    this.config.history = [];
                    saveConfig(this.config);
                    this.renderHistory();
                    this.showNotification('历史记录已清空', 'success');
                });
            }

            console.log('[KTKQ] 事件绑定完成');
        }
        
        bindHotkeys() {
            // 快捷键绑定（桌面端）
            if (!this.isMobile) {
                document.addEventListener('keydown', (e) => {
                    // Ctrl+H 或 Cmd+H: 隐藏/显示
                    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
                        e.preventDefault();
                        this.toggleHide();
                    }
                    
                    // Ctrl+M 或 Cmd+M: 最小化/还原
                    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
                        e.preventDefault();
                        this.toggleMinimize();
                    }
                    
                    // Ctrl+Shift+H: 紧急隐藏（同时隐藏按钮和菜单）
                    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'H') {
                        e.preventDefault();
                        this.emergencyHide();
                    }
                });
            }
            
            // 移动端手势支持
            if (this.isMobile) {
                // 长按按钮显示快捷菜单
                let longPressTimer;
                this.button.addEventListener('touchstart', (e) => {
                    longPressTimer = setTimeout(() => {
                        navigator.vibrate && navigator.vibrate(50); // 震动反馈
                        this.showQuickMenu(e.touches[0]);
                    }, 500);
                });
                
                this.button.addEventListener('touchend', () => {
                    clearTimeout(longPressTimer);
                });
                
                this.button.addEventListener('touchmove', () => {
                    clearTimeout(longPressTimer);
                });
                
                // 三击屏幕恢复隐藏的按钮
                this.bindTripleTap();
                
                // 双指捏合手势隐藏（在菜单上）
                let touchStartDistance = 0;
                this.menu.addEventListener('touchstart', (e) => {
                    if (e.touches.length === 2) {
                        const dx = e.touches[0].clientX - e.touches[1].clientX;
                        const dy = e.touches[0].clientY - e.touches[1].clientY;
                        touchStartDistance = Math.sqrt(dx * dx + dy * dy);
                    }
                });
                
                this.menu.addEventListener('touchmove', (e) => {
                    if (e.touches.length === 2) {
                        const dx = e.touches[0].clientX - e.touches[1].clientX;
                        const dy = e.touches[0].clientY - e.touches[1].clientY;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        
                        // 捏合缩小超过30%则隐藏
                        if (distance < touchStartDistance * 0.7) {
                            this.toggleHide();
                            this.toggleMenu();
                        }
                    }
                });
            }
            
            // 双击按钮切换最小化
            this.button.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.toggleMinimize();
            });
            
            // 右键/长按按钮显示快捷菜单
            this.button.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showQuickMenu(e);
            });
            
            console.log('[KTKQ] 快捷键绑定完成 (移动端:', this.isMobile, ')');
        }
        
        bindTripleTap() {
            let tapCount = 0;
            let tapTimer = null;
            
            document.addEventListener('touchend', (e) => {
                // 只在隐藏状态下监听
                if (!this.isHidden) return;
                
                tapCount++;
                
                if (tapCount === 1) {
                    tapTimer = setTimeout(() => {
                        tapCount = 0;
                    }, 500);
                } else if (tapCount === 3) {
                    clearTimeout(tapTimer);
                    tapCount = 0;
                    
                    // 恢复显示
                    this.isHidden = false;
                    this.button.style.opacity = '1';
                    this.button.style.pointerEvents = 'auto';
                    
                    navigator.vibrate && navigator.vibrate([30, 50, 30]);
                    this.showNotification('✨ 已恢复显示', 'success');
                    
                    console.log('[KTKQ] 三击恢复显示');
                }
            });
        }
        
        toggleHide() {
            this.isHidden = !this.isHidden;
            
            // 移动端震动反馈
            if (this.isMobile && navigator.vibrate) {
                navigator.vibrate(30);
            }
            
            if (this.isHidden) {
                this.button.style.opacity = '0';
                this.button.style.pointerEvents = 'none';
                if (this.menuVisible) {
                    this.toggleMenu();
                }
                
                // 显示提示信息
                if (this.isMobile) {
                    this.showNotification('已隐藏 (快速三击屏幕恢复)', 'info');
                } else {
                    this.showNotification('已隐藏 (Ctrl+H 恢复)', 'info');
                }
            } else {
                this.button.style.opacity = '1';
                this.button.style.pointerEvents = 'auto';
                this.showNotification('已显示', 'success');
            }
            
            console.log('[KTKQ] 隐藏状态:', this.isHidden);
        }
        
        toggleMinimize() {
            this.isMinimized = !this.isMinimized;
            this.config.isMinimized = this.isMinimized;
            saveConfig(this.config);
            
            // 移动端震动反馈
            if (this.isMobile && navigator.vibrate) {
                navigator.vibrate(30);
            }
            
            if (this.isMinimized) {
                this.button.classList.add('minimized');
                const msg = this.isMobile ? '已最小化 (双击还原)' : '已最小化 (Ctrl+M 还原)';
                this.showNotification(msg, 'info');
            } else {
                this.button.classList.remove('minimized');
                this.showNotification('已还原', 'success');
            }
            
            console.log('[KTKQ] 最小化状态:', this.isMinimized);
        }
        
        emergencyHide() {
            this.isHidden = true;
            this.button.style.display = 'none';
            if (this.menuVisible) {
                this.menu.classList.remove('show');
                this.menuVisible = false;
            }
            
            // 移动端强震动反馈
            if (this.isMobile && navigator.vibrate) {
                navigator.vibrate([50, 100, 50]);
            }
            
            // 3秒后自动恢复为隐藏状态
            setTimeout(() => {
                this.button.style.display = 'flex';
                this.button.style.opacity = '0';
                this.button.style.pointerEvents = 'none';
                
                if (this.isMobile) {
                    this.showNotification('紧急隐藏已解除 (三击屏幕显示)', 'warning');
                } else {
                    this.showNotification('紧急隐藏已解除 (Ctrl+H 显示)', 'warning');
                }
            }, 3000);
            
            console.log('[KTKQ] 紧急隐藏');
        }
        
        showQuickMenu(e) {
            // 移除旧菜单
            const oldMenu = document.getElementById('ktkq-quick-menu');
            if (oldMenu) oldMenu.remove();
            
            const menu = document.createElement('div');
            menu.id = 'ktkq-quick-menu';
            
            // 移动端使用底部工具栏样式
            if (this.isMobile) {
                menu.style.cssText = `
                    position: fixed;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: white;
                    border-radius: 20px 20px 0 0;
                    box-shadow: 0 -4px 24px rgba(0,0,0,0.2);
                    padding: 20px 16px calc(env(safe-area-inset-bottom) + 16px);
                    z-index: 10002;
                    animation: slideUpFromBottom 0.3s ease;
                `;
            } else {
                menu.style.cssText = `
                    position: fixed;
                    left: ${e.clientX}px;
                    top: ${e.clientY}px;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
                    padding: 8px;
                    z-index: 10002;
                    min-width: 160px;
                    animation: fadeIn 0.2s ease;
                `;
            }
            
            const items = [
                { icon: '👁️', text: this.isHidden ? '显示' : '隐藏', action: () => this.toggleHide() },
                { icon: '📏', text: this.isMinimized ? '还原' : '最小化', action: () => this.toggleMinimize() },
                { icon: '🚨', text: '紧急隐藏', action: () => this.emergencyHide() },
                { icon: '⚙️', text: '打开设置', action: () => { this.toggleMenu(); this.switchTab('settings'); } }
            ];
            
            if (this.isMobile) {
                // 移动端大按钮网格布局
                menu.innerHTML = `
                    <div style="text-align: center; margin-bottom: 16px; color: #6b7280; font-size: 14px; font-weight: 600;">
                        快捷操作
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                        ${items.map(item => `
                            <div class="ktkq-mobile-menu-item" style="
                                padding: 20px;
                                cursor: pointer;
                                border-radius: 16px;
                                background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                                border: 2px solid #e5e7eb;
                                transition: all 0.2s;
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                gap: 8px;
                                font-size: 14px;
                                color: #374151;
                                font-weight: 600;
                            ">
                                <span style="font-size: 32px;">${item.icon}</span>
                                <span>${item.text}</span>
                            </div>
                        `).join('')}
                    </div>
                    <button style="
                        width: 100%;
                        margin-top: 16px;
                        padding: 14px;
                        border: none;
                        border-radius: 12px;
                        background: #e5e7eb;
                        color: #374151;
                        font-size: 15px;
                        font-weight: 600;
                        cursor: pointer;
                    ">取消</button>
                `;
            } else {
                // 桌面端列表布局
                menu.innerHTML = items.map(item => `
                    <div class="ktkq-quick-menu-item" style="
                        padding: 10px 14px;
                        cursor: pointer;
                        border-radius: 8px;
                        transition: all 0.2s;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        font-size: 14px;
                        color: #374151;
                    " onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">
                        <span style="font-size: 18px;">${item.icon}</span>
                        <span>${item.text}</span>
                    </div>
                `).join('');
            }
            
            document.body.appendChild(menu);
            
            // 添加触摸反馈
            if (this.isMobile) {
                const mobileItems = menu.querySelectorAll('.ktkq-mobile-menu-item');
                mobileItems.forEach((item, index) => {
                    item.addEventListener('touchstart', () => {
                        item.style.transform = 'scale(0.95)';
                        item.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                        item.style.color = 'white';
                    });
                    item.addEventListener('touchend', () => {
                        item.style.transform = 'scale(1)';
                        setTimeout(() => {
                            items[index].action();
                            menu.remove();
                        }, 100);
                    });
                });
                
                // 取消按钮
                const cancelBtn = menu.querySelector('button');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', () => menu.remove());
                }
            } else {
                // 桌面端点击事件
                menu.querySelectorAll('.ktkq-quick-menu-item').forEach((item, index) => {
                    item.addEventListener('click', () => {
                        items[index].action();
                        menu.remove();
                    });
                });
            }
            
            // 点击外部关闭
            setTimeout(() => {
                const closeMenu = (e) => {
                    if (!menu.contains(e.target)) {
                        menu.remove();
                        document.removeEventListener('click', closeMenu);
                        document.removeEventListener('touchstart', closeMenu);
                    }
                };
                document.addEventListener('click', closeMenu);
                document.addEventListener('touchstart', closeMenu);
            }, 100);
        }
        
        bindDrag() {
            let state = { startX: 0, startY: 0, left: 0, top: 0, moved: false };
            
            const onStart = (e) => {
                const touch = e.touches ? e.touches[0] : e;
                state.startX = touch.clientX;
                state.startY = touch.clientY;
                const rect = this.button.getBoundingClientRect();
                state.left = rect.left;
                state.top = rect.top;
                state.moved = false;
                this.isDragging = true;
                this.button.classList.add('dragging');
            };
            
            const onMove = (e) => {
                if (!this.isDragging) return;
                e.preventDefault();
                const touch = e.touches ? e.touches[0] : e;
                const dx = touch.clientX - state.startX;
                const dy = touch.clientY - state.startY;
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) state.moved = true;
                if (!state.moved) return;
                
                let newLeft = Math.max(0, Math.min(state.left + dx, window.innerWidth - this.button.offsetWidth));
                let newTop = Math.max(0, Math.min(state.top + dy, window.innerHeight - this.button.offsetHeight));
                this.button.style.left = newLeft + 'px';
                this.button.style.top = newTop + 'px';
                this.button.style.right = 'auto';
                this.button.style.bottom = 'auto';
            };
            
            const onEnd = () => {
                if (!this.isDragging) return;
                this.isDragging = false;
                this.button.classList.remove('dragging');
                if (state.moved) {
                    this.justDragged = true;
                    this.config.btnPosition = {
                        left: parseInt(this.button.style.left),
                        top: parseInt(this.button.style.top),
                        right: null,
                        bottom: null
                    };
                    saveConfig(this.config);
                    setTimeout(() => this.justDragged = false, 100);
                }
            };
            
            this.button.addEventListener('mousedown', onStart);
            this.button.addEventListener('touchstart', onStart, { passive: false });
            document.addEventListener('mousemove', onMove, { passive: false });
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchend', onEnd);
        }

        
        toggleMenu() {
            this.menuVisible = !this.menuVisible;
            this.menu.classList.toggle('show', this.menuVisible);
        }
        
        switchTab(tabName) {
            document.querySelectorAll('.ktkq-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.ktkq-panel').forEach(p => p.classList.remove('active'));
            document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
            document.getElementById(`ktkq-panel-${tabName}`).classList.add('active');
        }
        
        showBetaCodeModal() {
            const modalHTML = `
                <div id="ktkq-beta-modal" class="ktkq-disclaimer-modal">
                    <div class="ktkq-disclaimer-overlay"></div>
                    <div class="ktkq-disclaimer-dialog">
                        <div class="ktkq-disclaimer-header">
                            <div class="ktkq-disclaimer-logo">🔐</div>
                            <h3>内测验证</h3>
                            <p>欢迎使用 SMUPhantom</p>
                        </div>
                        <div class="ktkq-disclaimer-body">
                            <div class="ktkq-disclaimer-text">
                                <h4>🎯 内测说明</h4>
                                <p style="line-height: 1.8; color: #6b7280; margin-bottom: 20px;">
                                    本工具目前处于内测阶段，仅对特定用户开放。请输入您获得的内测码以继续使用。
                                </p>
                                <div style="margin: 24px 0;">
                                    <label style="display: block; margin-bottom: 8px; color: #374151; font-weight: 600;">
                                        请输入内测码：
                                    </label>
                                    <input 
                                        type="text" 
                                        id="ktkq-beta-code-input" 
                                        placeholder="请输入内测码"
                                        style="
                                            width: 100%;
                                            padding: 12px 16px;
                                            border: 2px solid #e5e7eb;
                                            border-radius: 8px;
                                            font-size: 15px;
                                            transition: all 0.2s;
                                            box-sizing: border-box;
                                        "
                                    />
                                    <div id="ktkq-beta-error" style="
                                        color: #ef4444;
                                        font-size: 13px;
                                        margin-top: 8px;
                                        display: none;
                                    ">
                                        ❌ 内测码错误，请重新输入
                                    </div>
                                </div>
                                <div class="ktkq-disclaimer-warning">
                                    <span class="ktkq-warning-icon">💡</span>
                                    <p><strong>提示</strong>：如果您还没有内测码，请联系开发者获取。</p>
                                </div>
                            </div>
                        </div>
                        <div class="ktkq-disclaimer-footer">
                            <div class="ktkq-disclaimer-buttons">
                                <button class="ktkq-btn-secondary" id="ktkq-beta-cancel">退出</button>
                                <button class="ktkq-btn-primary" id="ktkq-beta-verify">验证并继续</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            
            const modal = document.getElementById('ktkq-beta-modal');
            const input = document.getElementById('ktkq-beta-code-input');
            const errorMsg = document.getElementById('ktkq-beta-error');
            const verifyBtn = document.getElementById('ktkq-beta-verify');
            const cancelBtn = document.getElementById('ktkq-beta-cancel');
            
            // 输入框样式交互
            input.addEventListener('focus', () => {
                input.style.borderColor = '#667eea';
                input.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.1)';
            });
            
            input.addEventListener('blur', () => {
                input.style.borderColor = '#e5e7eb';
                input.style.boxShadow = 'none';
            });
            
            // 输入时隐藏错误提示
            input.addEventListener('input', () => {
                errorMsg.style.display = 'none';
                input.style.borderColor = '#e5e7eb';
            });
            
            // 回车验证
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    verifyBtn.click();
                }
            });
            
            // 验证按钮
            verifyBtn.addEventListener('click', () => {
                const code = input.value.trim();
                
                if (!code) {
                    errorMsg.textContent = '❌ 请输入内测码';
                    errorMsg.style.display = 'block';
                    input.style.borderColor = '#ef4444';
                    input.focus();
                    return;
                }
                
                if (code === BETA_CODE) {
                    // 验证成功
                    this.config.betaCodeVerified = true;
                    saveConfig(this.config);
                    modal.remove();
                    
                    // 显示成功提示
                    this.showNotification('✅ 内测码验证成功！', 'success');
                    
                    // 继续显示免责声明
                    setTimeout(() => {
                        this.showDisclaimerModal();
                    }, 500);
                } else {
                    // 验证失败
                    errorMsg.textContent = '❌ 内测码错误，请重新输入';
                    errorMsg.style.display = 'block';
                    input.style.borderColor = '#ef4444';
                    input.value = '';
                    input.focus();
                    
                    // 震动反馈（移动端）
                    if (navigator.vibrate) {
                        navigator.vibrate([50, 100, 50]);
                    }
                }
            });
            
            // 取消按钮
            cancelBtn.addEventListener('click', () => {
                modal.remove();
                
                // 禁用按钮
                this.button.style.opacity = '0.5';
                this.button.style.cursor = 'not-allowed';
                this.button.innerHTML = '<span style="font-size: 20px;">🔒</span><span>未验证</span>';
                
                this.showNotification('❌ 未验证内测码，脚本功能已禁用', 'error');
                console.log('[KTKQ] 用户取消内测码验证，脚本功能已禁用');
            });
            
            // 点击遮罩层不关闭
            const overlay = modal.querySelector('.ktkq-disclaimer-overlay');
            overlay.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            
            // 自动聚焦输入框
            setTimeout(() => {
                input.focus();
            }, 300);
        }
        
        showDisclaimerModal() {
            const modalHTML = `
                <div id="ktkq-disclaimer-modal" class="ktkq-disclaimer-modal">
                    <div class="ktkq-disclaimer-overlay"></div>
                    <div class="ktkq-disclaimer-dialog">
                        <div class="ktkq-disclaimer-header">
                            <div class="ktkq-disclaimer-logo">⚠️</div>
                            <h3>免责声明</h3>
                            <p>使用前请仔细阅读</p>
                        </div>
                        <div class="ktkq-disclaimer-body">
                            <div class="ktkq-disclaimer-text">
                                <h4>📜 使用条款</h4>
                                <ol>
                                    <li><strong>学习交流目的</strong>：本工具仅供学习交流使用，旨在帮助用户了解自动化脚本的工作原理。</li>
                                    <li><strong>禁止违规使用</strong>：严禁将本工具用于违反学校考勤规定的行为，包括但不限于虚假打卡、代打卡等。</li>
                                    <li><strong>遵守校规校纪</strong>：用户应严格遵守西南民族大学的各项规章制度，按时参加考勤。</li>
                                    <li><strong>自担风险</strong>：使用本工具产生的一切后果由用户自行承担，开发者不承担任何责任。</li>
                                    <li><strong>数据安全</strong>：本工具不会收集、上传任何用户数据，所有配置信息仅保存在本地浏览器中。</li>
                                    <li><strong>无担保声明</strong>：本工具按"现状"提供，不提供任何明示或暗示的担保。</li>
                                </ol>
                                <div class="ktkq-disclaimer-warning">
                                    <span class="ktkq-warning-icon">🚨</span>
                                    <p><strong>特别提醒</strong>：违规使用可能导致严重后果，请三思而后行！</p>
                                </div>
                            </div>
                        </div>
                        <div class="ktkq-disclaimer-footer">
                            <label class="ktkq-disclaimer-checkbox">
                                <input type="checkbox" id="ktkq-disclaimer-agree" />
                                <span class="ktkq-checkbox-mark"></span>
                                <span>我已阅读并同意以上免责声明，自愿承担使用风险</span>
                            </label>
                            <div class="ktkq-disclaimer-buttons">
                                <button class="ktkq-btn-secondary" id="ktkq-disclaimer-cancel">拒绝并退出</button>
                                <button class="ktkq-btn-primary" id="ktkq-disclaimer-accept" disabled>同意并继续</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            
            const modal = document.getElementById('ktkq-disclaimer-modal');
            const checkbox = document.getElementById('ktkq-disclaimer-agree');
            const acceptBtn = document.getElementById('ktkq-disclaimer-accept');
            const cancelBtn = document.getElementById('ktkq-disclaimer-cancel');
            
            checkbox.addEventListener('change', () => {
                acceptBtn.disabled = !checkbox.checked;
            });
            
            acceptBtn.addEventListener('click', () => {
                this.config.disclaimerAccepted = true;
                saveConfig(this.config);
                modal.remove();
                
                // 打开菜单并显示欢迎信息
                this.toggleMenu();
                this.showNotification('👋 欢迎使用 SMUPhantom！请先完成初始设置', 'success');
            });
            
            cancelBtn.addEventListener('click', () => {
                modal.remove();
                
                // 不完全隐藏按钮，而是禁用功能并添加视觉提示
                this.button.style.opacity = '0.5';
                this.button.style.cursor = 'not-allowed';
                this.button.innerHTML = '<span style="font-size: 20px;">🚫</span><span>已禁用</span>';
                
                // 显示持久化的警告提示
                this.showPersistentWarning();
                
                console.log('[KTKQ] 用户拒绝免责声明，脚本功能已禁用');
            });
            
            // 点击遮罩层不关闭
            const overlay = modal.querySelector('.ktkq-disclaimer-overlay');
            overlay.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
        
        showPersistentWarning() {
            // 创建持久化的警告提示
            const warningHTML = `
                <div id="ktkq-persistent-warning" class="ktkq-persistent-warning">
                    <div class="ktkq-warning-content">
                        <div class="ktkq-warning-icon">⚠️</div>
                        <div class="ktkq-warning-text">
                            <h4>脚本功能已禁用</h4>
                            <p>您已拒绝免责声明，SMUPhantom 的所有功能将不可用。</p>
                            <p>如需使用，请刷新页面并同意免责声明。</p>
                        </div>
                        <button id="ktkq-warning-close" class="ktkq-warning-close">&times;</button>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', warningHTML);
            
            // 关闭按钮
            const closeBtn = document.getElementById('ktkq-warning-close');
            closeBtn.addEventListener('click', () => {
                document.getElementById('ktkq-persistent-warning').remove();
            });
            
            // 5秒后自动关闭
            setTimeout(() => {
                const warning = document.getElementById('ktkq-persistent-warning');
                if (warning) {
                    warning.style.animation = 'slideUp 0.3s ease forwards';
                    setTimeout(() => warning.remove(), 300);
                }
            }, 5000);
        }
        
        showResetConfirmation() {
            const confirmHTML = `
                <div id="ktkq-reset-modal" class="ktkq-reset-modal">
                    <div class="ktkq-reset-overlay"></div>
                    <div class="ktkq-reset-dialog">
                        <div class="ktkq-reset-header">
                            <div class="ktkq-reset-icon">⚠️</div>
                            <h3>确认恢复初始状态</h3>
                        </div>
                        <div class="ktkq-reset-body">
                            <p class="ktkq-reset-warning">此操作将清除以下所有数据，且无法恢复：</p>
                            <ul class="ktkq-reset-list">
                                <li>✓ 内测码验证状态</li>
                                <li>✓ 免责声明同意状态</li>
                                <li>✓ 所有位置预设</li>
                                <li>✓ 历史记录</li>
                                <li>✓ 坐标设置</li>
                                <li>✓ 虚拟定位状态</li>
                                <li>✓ 夜间模式设置</li>
                                <li>✓ 按钮位置</li>
                            </ul>
                            <p class="ktkq-reset-tip">💡 恢复后，脚本将回到首次使用状态，需要重新输入内测码并同意免责声明。</p>
                        </div>
                        <div class="ktkq-reset-footer">
                            <button class="ktkq-btn-secondary" id="ktkq-reset-cancel">取消</button>
                            <button class="ktkq-btn-danger" id="ktkq-reset-confirm">确认恢复</button>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', confirmHTML);
            
            const modal = document.getElementById('ktkq-reset-modal');
            const cancelBtn = document.getElementById('ktkq-reset-cancel');
            const confirmBtn = document.getElementById('ktkq-reset-confirm');
            
            cancelBtn.addEventListener('click', () => {
                modal.remove();
            });
            
            confirmBtn.addEventListener('click', () => {
                this.resetScript();
                modal.remove();
            });
            
            // 点击遮罩层关闭
            const overlay = modal.querySelector('.ktkq-reset-overlay');
            overlay.addEventListener('click', () => {
                modal.remove();
            });
        }
        
        resetScript() {
            try {
                // 清除所有保存的配置
                GM_setValue(CONFIG_KEY, null);
                
                console.log('[KTKQ] 配置已清除，准备重新加载页面');
                
                // 显示成功提示
                this.showNotification('✅ 已恢复初始状态，页面即将刷新...', 'success');
                
                // 1.5秒后刷新页面
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } catch (e) {
                console.error('[KTKQ] 恢复初始状态失败:', e);
                this.showNotification('❌ 恢复失败，请手动刷新页面', 'error');
            }
        }
        
        toggleVirtual() {
            if (this.config.virtualEnabled) {
                this.stopVirtual();
            } else {
                if (!this.config.latitude || !this.config.longitude) {
                    this.showNotification('请先设置坐标', 'warning');
                    return;
                }
                this.startVirtual();
            }
            this._syncStatusVirtualCard();
        }
        
        startVirtual() {
            const lat = parseFloat(this.config.latitude);
            const lng = parseFloat(this.config.longitude);
            if (isNaN(lat) || isNaN(lng)) {
                this.showNotification('坐标格式错误', 'error');
                return;
            }
            
            const createPosition = () => ({
                coords: {
                    latitude: lat,
                    longitude: lng,
                    accuracy: this.config.accuracy,
                    altitude: null,
                    altitudeAccuracy: null,
                    heading: null,
                    speed: null
                },
                timestamp: Date.now()
            });
            
            // ── 方法一：直接覆盖实例属性（最基础，兼容性最广）──
            const fakeGetCurrentPosition = (success, error, options) => {
                try { if (success) success(createPosition()); }
                catch (e) { if (error) error({ code: 2, message: e.message }); }
            };
            const fakeWatchPosition = (success, error, options) => {
                try {
                    if (success) success(createPosition());
                    // 持续推送，模拟真实 watch 行为
                    const id = setInterval(() => {
                        try { if (success) success(createPosition()); } catch (_) {}
                    }, 3000);
                    this._watchIds.push(id);
                    return id;
                } catch (e) {
                    if (error) error({ code: 2, message: e.message });
                    return -1;
                }
            };
            const fakeClearWatch = (id) => {
                clearInterval(id);
                this._watchIds = this._watchIds.filter(i => i !== id);
            };
            
            navigator.geolocation.getCurrentPosition = fakeGetCurrentPosition;
            navigator.geolocation.watchPosition      = fakeWatchPosition;
            navigator.geolocation.clearWatch         = fakeClearWatch;
            
            // ── 方法二：覆盖 Geolocation.prototype（防止页面通过原型链绕过）──
            try {
                const proto = Object.getPrototypeOf(navigator.geolocation);
                Object.defineProperty(proto, 'getCurrentPosition', {
                    configurable: true, writable: true, value: fakeGetCurrentPosition
                });
                Object.defineProperty(proto, 'watchPosition', {
                    configurable: true, writable: true, value: fakeWatchPosition
                });
                Object.defineProperty(proto, 'clearWatch', {
                    configurable: true, writable: true, value: fakeClearWatch
                });
                console.log('[KTKQ] 方法二 (prototype) 注入成功');
            } catch (e) {
                console.warn('[KTKQ] 方法二 (prototype) 注入失败:', e.message);
            }
            
            // ── 方法三：通过 unsafeWindow 覆盖页面原始 window 上的对象（油猴沙箱穿透）──
            try {
                if (typeof unsafeWindow !== 'undefined' && unsafeWindow.navigator.geolocation) {
                    const uw = unsafeWindow.navigator.geolocation;
                    uw.getCurrentPosition = fakeGetCurrentPosition;
                    uw.watchPosition      = fakeWatchPosition;
                    uw.clearWatch         = fakeClearWatch;
                    // 同时覆盖 unsafeWindow 的 prototype
                    const uwProto = Object.getPrototypeOf(uw);
                    Object.defineProperty(uwProto, 'getCurrentPosition', {
                        configurable: true, writable: true, value: fakeGetCurrentPosition
                    });
                    Object.defineProperty(uwProto, 'watchPosition', {
                        configurable: true, writable: true, value: fakeWatchPosition
                    });
                    Object.defineProperty(uwProto, 'clearWatch', {
                        configurable: true, writable: true, value: fakeClearWatch
                    });
                    console.log('[KTKQ] 方法三 (unsafeWindow) 注入成功');
                }
            } catch (e) {
                console.warn('[KTKQ] 方法三 (unsafeWindow) 注入失败:', e.message);
            }
            
            // ── 方法四：MutationObserver 守护，防止页面动态脚本恢复原始方法 ──
            this._startGuard(fakeGetCurrentPosition, fakeWatchPosition, fakeClearWatch);
            
            this.config.virtualEnabled = true;
            saveConfig(this.config);
            const sw = document.getElementById('ktkq-virtual-switch');
            const st = document.getElementById('ktkq-virtual-status');
            const card = sw && sw.closest('.ktkq-virtual-card');
            if (sw) sw.classList.add('on');
            if (st) st.textContent = '已启用 · 坐标生效中';
            if (card) { card.classList.add('active'); card.querySelector('.ktkq-virtual-icon').textContent = '🟣'; }
            this.showNotification('虚拟定位已启用', 'success');
            console.log('[KTKQ] 虚拟定位已启用:', lat, lng);
            this.refreshPageLocation();
            setTimeout(() => this.detectPageLocation(), 500);
        }
        
        // 守护线程：定期检测并重新注入，防止被页面脚本覆盖
        _startGuard(fakeGet, fakeWatch, fakeClear) {
            this._stopGuard();
            this._guardTimer = setInterval(() => {
                if (!this.config.virtualEnabled) return;
                let reinjected = false;
                if (navigator.geolocation.getCurrentPosition !== fakeGet) {
                    navigator.geolocation.getCurrentPosition = fakeGet;
                    reinjected = true;
                }
                if (navigator.geolocation.watchPosition !== fakeWatch) {
                    navigator.geolocation.watchPosition = fakeWatch;
                    reinjected = true;
                }
                if (typeof unsafeWindow !== 'undefined' && unsafeWindow.navigator.geolocation) {
                    const uw = unsafeWindow.navigator.geolocation;
                    if (uw.getCurrentPosition !== fakeGet) { uw.getCurrentPosition = fakeGet; reinjected = true; }
                    if (uw.watchPosition !== fakeWatch)     { uw.watchPosition = fakeWatch;     reinjected = true; }
                }
                if (reinjected) console.warn('[KTKQ] 守护线程：检测到定位方法被覆盖，已重新注入');
            }, 1000);
        }
        
        _stopGuard() {
            if (this._guardTimer) {
                clearInterval(this._guardTimer);
                this._guardTimer = null;
            }
        }
        
        stopVirtual() {
            // 停止守护线程
            this._stopGuard();
            
            // 清理所有虚拟 watchPosition 的 interval
            this._watchIds.forEach(id => clearInterval(id));
            this._watchIds = [];
            
            // 恢复三个方法到所有目标对象
            const restore = (geo) => {
                if (!geo) return;
                try {
                    geo.getCurrentPosition = this.originalGetCurrentPosition;
                    geo.watchPosition      = this.originalWatchPosition;
                    geo.clearWatch         = this.originalClearWatch;
                } catch (e) {}
                try {
                    const proto = Object.getPrototypeOf(geo);
                    Object.defineProperty(proto, 'getCurrentPosition', { configurable: true, writable: true, value: this.originalGetCurrentPosition });
                    Object.defineProperty(proto, 'watchPosition',      { configurable: true, writable: true, value: this.originalWatchPosition });
                    Object.defineProperty(proto, 'clearWatch',         { configurable: true, writable: true, value: this.originalClearWatch });
                } catch (e) {}
            };
            
            restore(navigator.geolocation);
            if (typeof unsafeWindow !== 'undefined') restore(unsafeWindow.navigator.geolocation);
            
            this.config.virtualEnabled = false;
            saveConfig(this.config);
            const sw = document.getElementById('ktkq-virtual-switch');
            const st = document.getElementById('ktkq-virtual-status');
            const card = sw && sw.closest('.ktkq-virtual-card');
            if (sw) sw.classList.remove('on');
            if (st) st.textContent = '未启用 · 使用真实位置';
            if (card) { card.classList.remove('active'); card.querySelector('.ktkq-virtual-icon').textContent = '⚪'; }
            this.showNotification('虚拟定位已停止', 'info');
            console.log('[KTKQ] 虚拟定位已停止，原始方法已恢复');
            this.refreshPageLocation();
            setTimeout(() => this.detectPageLocation(), 500);
        }

        refreshPageLocation() {
            // 触发一次定位请求，让页面感知定位变化
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    console.log('[KTKQ] 页面定位已刷新:', pos.coords.latitude, pos.coords.longitude);
                },
                (err) => {
                    console.warn('[KTKQ] 页面定位刷新失败:', err.message);
                },
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        }

        // 新增：刷新定位状态功能（优化版）
        refreshLocationStatus() {
            this.showNotification('正在刷新定位状态...', 'info');
            
            // 连续触发3次定位请求，确保页面感知
            for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                    this.refreshPageLocation();
                }, i * 500);
            }
            
            setTimeout(() => {
                this.showNotification('✅ 定位状态已刷新', 'success');
            }, 1500);
        }
        
        // 新增：检测网页定位状态
        detectPageLocation(silent = false) {
            const circle = document.getElementById('ktkq-status-circle');
            const circleIcon = document.getElementById('ktkq-status-circle-icon');
            const badgeText = document.getElementById('ktkq-status-badge-text');
            const heroSub = document.getElementById('ktkq-status-hero-sub');
            const latEl = document.getElementById('ktkq-page-lat');
            const lngEl = document.getElementById('ktkq-page-lng');
            const accuracyEl = document.getElementById('ktkq-page-accuracy');
            const timeEl = document.getElementById('ktkq-page-time');
            const sourceEl = document.getElementById('ktkq-page-source');
            const errorBox = document.getElementById('ktkq-status-error-box');
            const errorMsg = document.getElementById('ktkq-status-error-msg');
            
            // 检测中状态
            if (circle) { circle.className = 'ktkq-status-circle loading'; circleIcon.textContent = '🔄'; }
            if (badgeText) badgeText.textContent = '检测中...';
            if (heroSub) heroSub.textContent = '正在获取定位信息，请稍候...';
            if (errorBox) errorBox.style.display = 'none';
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude, accuracy } = position.coords;
                    const timestamp = new Date(position.timestamp);
                    const isVirtual = this.config.virtualEnabled;
                    
                    if (circle) { circle.className = 'ktkq-status-circle success'; circleIcon.textContent = isVirtual ? '🟣' : '🟢'; }
                    if (badgeText) badgeText.textContent = isVirtual ? '虚拟定位生效' : '真实定位';
                    if (heroSub) heroSub.textContent = isVirtual ? '坐标已被 SMUPhantom 虚拟替换' : '使用设备真实 GPS 位置';
                    
                    if (latEl) latEl.textContent = latitude.toFixed(6);
                    if (lngEl) lngEl.textContent = longitude.toFixed(6);
                    if (accuracyEl) accuracyEl.textContent = `±${Math.round(accuracy)}m`;
                    if (timeEl) timeEl.textContent = timestamp.toLocaleTimeString('zh-CN');
                    if (sourceEl) sourceEl.textContent = isVirtual ? '虚拟 (SMUPhantom)' : '设备 GPS';
                    if (errorBox) errorBox.style.display = 'none';
                    
                    this._lastDetectedLat = latitude;
                    this._lastDetectedLng = longitude;
                    
                    if (!silent) this.showNotification('✅ 定位检测成功', 'success');
                    console.log('[KTKQ] 定位检测:', { latitude, longitude, accuracy, isVirtual });
                },
                (error) => {
                    if (circle) { circle.className = 'ktkq-status-circle error'; circleIcon.textContent = '🔴'; }
                    if (badgeText) badgeText.textContent = '定位失败';
                    if (heroSub) heroSub.textContent = '无法获取定位信息';
                    if (latEl) latEl.textContent = '--';
                    if (lngEl) lngEl.textContent = '--';
                    if (accuracyEl) accuracyEl.textContent = '--';
                    if (timeEl) timeEl.textContent = '--';
                    if (sourceEl) sourceEl.textContent = '--';
                    
                    const msgs = { 1: '用户拒绝了定位权限', 2: '无法获取位置信息', 3: '定位请求超时' };
                    const msg = msgs[error.code] || '未知错误';
                    if (errorBox) { errorBox.style.display = 'flex'; errorMsg.textContent = msg; }
                    
                    if (!silent) this.showNotification(`❌ ${msg}`, 'error');
                    console.error('[KTKQ] 定位检测失败:', error.message);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
        }
        
        // 自动刷新定位状态
        toggleAutoRefresh() {
            if (this._autoRefreshTimer) {
                clearInterval(this._autoRefreshTimer);
                this._autoRefreshTimer = null;
                const btn = document.getElementById('ktkq-auto-refresh-toggle');
                const label = document.getElementById('ktkq-auto-refresh-label');
                if (btn) btn.classList.remove('active');
                if (label) label.textContent = '自动刷新: 关闭';
                this.showNotification('自动刷新已关闭', 'info');
            } else {
                this._autoRefreshTimer = setInterval(() => this.detectPageLocation(true), 5000);
                const btn = document.getElementById('ktkq-auto-refresh-toggle');
                const label = document.getElementById('ktkq-auto-refresh-label');
                if (btn) btn.classList.add('active');
                if (label) label.textContent = '自动刷新: 每5秒';
                this.detectPageLocation(true);
                this.showNotification('自动刷新已开启 (每5秒)', 'success');
            }
        }

        // 新增：添加到历史记录
        addToHistory(lat, lng, name = '') {
            if (!this.config.history) this.config.history = [];
            
            const historyItem = {
                latitude: lat,
                longitude: lng,
                name: name || `位置 ${this.config.history.length + 1}`,
                timestamp: Date.now()
            };
            
            // 避免重复记录（相同坐标）
            const exists = this.config.history.some(h => 
                Math.abs(parseFloat(h.latitude) - parseFloat(lat)) < 0.0001 &&
                Math.abs(parseFloat(h.longitude) - parseFloat(lng)) < 0.0001
            );
            
            if (!exists) {
                this.config.history.unshift(historyItem);
                // 只保留最近20条
                if (this.config.history.length > 20) {
                    this.config.history = this.config.history.slice(0, 20);
                }
                saveConfig(this.config);
            }
        }

        // 新增：计算两点距离（米）
        calculateDistance(lat1, lng1, lat2, lng2) {
            const R = 6371000; // 地球半径（米）
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLng/2) * Math.sin(dLng/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return R * c;
        }

        // 渲染历史记录列表
        renderHistory() {
            const container = document.getElementById('ktkq-history-list');
            if (!container) return;
            const history = this.config.history || [];
            if (history.length === 0) {
                container.innerHTML = '<div class="ktkq-history-empty">暂无历史记录</div>';
                return;
            }
            container.innerHTML = history.slice(0, 5).map((h, i) => `
                <div class="ktkq-history-item" data-index="${i}">
                    <div class="ktkq-history-info">
                        <div class="ktkq-history-name">${h.name || '未命名位置'}</div>
                        <div class="ktkq-history-coords">${parseFloat(h.latitude).toFixed(6)}, ${parseFloat(h.longitude).toFixed(6)}</div>
                    </div>
                    <button class="ktkq-history-use-btn" data-lat="${h.latitude}" data-lng="${h.longitude}" title="使用此坐标">使用</button>
                </div>
            `).join('');

            container.querySelectorAll('.ktkq-history-use-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const lat = btn.dataset.lat;
                    const lng = btn.dataset.lng;
                    document.getElementById('ktkq-lat').value = lat;
                    document.getElementById('ktkq-lng').value = lng;
                    this.config.latitude = lat;
                    this.config.longitude = lng;
                    saveConfig(this.config);
                    this.showNotification('✅ 历史坐标已填入', 'success');
                });
            });
        }

        // 同步状态页虚拟定位卡片UI
        _syncStatusVirtualCard() {
            const enabled = this.config.virtualEnabled;
            const card = document.getElementById('ktkq-status-virtual-card');
            const sw = document.getElementById('ktkq-status-virtual-switch');
            const icon = document.getElementById('ktkq-status-virtual-icon');
            const sub = document.getElementById('ktkq-status-virtual-sub');
            if (!card) return;
            if (enabled) {
                card.classList.add('active');
                if (sw) sw.classList.add('on');
                if (icon) icon.textContent = '🟣';
                if (sub) sub.textContent = '已启用 · 坐标生效中';
            } else {
                card.classList.remove('active');
                if (sw) sw.classList.remove('on');
                if (icon) icon.textContent = '⚪';
                if (sub) sub.textContent = '未启用 · 使用真实位置';
            }
        }


        // 新增：复制坐标
        copyCoords() {
            const lat = this.config.latitude;
            const lng = this.config.longitude;
            
            if (!lat || !lng) {
                this.showNotification('请先设置坐标', 'warning');
                return;
            }
            
            const coordsText = `📍 位置坐标\n纬度: ${lat}\n经度: ${lng}\n\n高德地图: https://uri.amap.com/marker?position=${lng},${lat}`;
            
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(coordsText).then(() => {
                    this.showNotification('✅ 坐标已复制到剪贴板', 'success');
                }).catch(() => {
                    this.fallbackCopyText(coordsText);
                });
            } else {
                this.fallbackCopyText(coordsText);
            }
        }

        // 备用复制方法
        fallbackCopyText(text) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                this.showNotification('✅ 坐标已复制到剪贴板', 'success');
            } catch (err) {
                this.showNotification('❌ 复制失败，请手动复制', 'error');
            }
            document.body.removeChild(textarea);
        }

        
        getCurrentLocation() {
            this.showNotification('正在获取位置...', 'info');
            this.originalGetCurrentPosition(
                (pos) => {
                    const lat = pos.coords.latitude.toFixed(8);
                    const lng = pos.coords.longitude.toFixed(8);
                    document.getElementById('ktkq-lat').value = lat;
                    document.getElementById('ktkq-lng').value = lng;
                    this.config.latitude = lat;
                    this.config.longitude = lng;
                    saveConfig(this.config);
                    this.showNotification('位置获取成功', 'success');
                },
                (err) => {
                    this.showNotification('定位失败: ' + err.message, 'error');
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        }
        
        applyCoords() {
            const lat = document.getElementById('ktkq-lat').value.trim();
            const lng = document.getElementById('ktkq-lng').value.trim();
            if (!lat || !lng) {
                this.showNotification('请输入坐标', 'warning');
                return;
            }
            this.config.latitude = lat;
            this.config.longitude = lng;
            saveConfig(this.config);
            
            // 添加到历史记录
            this.addToHistory(lat, lng);
            this.renderHistory();
            
            if (this.config.virtualEnabled) {
                this.startVirtual();
                this.showNotification('坐标已更新并应用', 'success');
            } else {
                this.showNotification('坐标已保存', 'success');
            }
            
            // 刷新网页定位
            setTimeout(() => {
                this.refreshPageLocation();
            }, 300);
        }
        
        savePreset() {
            const name = document.getElementById('ktkq-preset-name').value.trim();
            const category = document.getElementById('ktkq-preset-category').value;
            const lat = document.getElementById('ktkq-preset-lat').value.trim();
            const lng = document.getElementById('ktkq-preset-lng').value.trim();
            
            if (!name || !lat || !lng) {
                this.showNotification('请填写完整信息', 'warning');
                return;
            }
            
            const editingIndex = document.getElementById('ktkq-preset-name').dataset.editIndex;
            
            if (editingIndex !== undefined) {
                // 编辑模式
                const index = parseInt(editingIndex);
                this.config.presets[index] = {
                    ...this.config.presets[index],
                    name,
                    category,
                    latitude: lat,
                    longitude: lng
                };
                delete document.getElementById('ktkq-preset-name').dataset.editIndex;
                document.getElementById('ktkq-save-preset').textContent = '保存预设';
                this.showNotification('预设已更新', 'success');
            } else {
                // 新增模式
                if (this.config.presets.some(p => p.name === name)) {
                    this.showNotification('预设名称已存在', 'error');
                    return;
                }
                this.config.presets.push({
                    name,
                    category,
                    latitude: lat,
                    longitude: lng,
                    favorite: false,
                    createdAt: Date.now()
                });
                this.showNotification('预设已保存', 'success');
            }
            
            saveConfig(this.config);
            this.renderPresets();
            document.getElementById('ktkq-preset-name').value = '';
            document.getElementById('ktkq-preset-category').value = 'other';
        }
        
        renderPresets() {
            const list = document.getElementById('ktkq-preset-list');
            if (!list) {
                console.warn('[KTKQ] 预设列表元素未找到');
                return;
            }
            
            const searchTerm = document.getElementById('ktkq-preset-search')?.value.toLowerCase() || '';
            
            if (!this.config.presets.length) {
                list.innerHTML = '<div class="ktkq-empty">暂无预设</div>';
                this.renderQuickPresets();
                return;
            }
            
            // 过滤和排序
            let presets = this.config.presets.filter(p => 
                p.name.toLowerCase().includes(searchTerm) ||
                (p.category && this.getCategoryName(p.category).includes(searchTerm))
            );
            
            // 按收藏和创建时间排序
            presets.sort((a, b) => {
                if (a.favorite && !b.favorite) return -1;
                if (!a.favorite && b.favorite) return 1;
                return (b.createdAt || 0) - (a.createdAt || 0);
            });
            
            // 按分组显示
            const grouped = this.groupPresets(presets);
            
            list.innerHTML = Object.entries(grouped).map(([category, items]) => `
                <div class="ktkq-preset-group">
                    <div class="ktkq-preset-group-title">${this.getCategoryName(category)}</div>
                    ${items.map((p, index) => {
                        const globalIndex = this.config.presets.indexOf(p);
                        return `
                        <div class="ktkq-preset-item ${p.favorite ? 'favorite' : ''}" data-index="${globalIndex}">
                            <div class="ktkq-preset-drag">⋮⋮</div>
                            <div class="ktkq-preset-info" data-action="apply" data-index="${globalIndex}">
                                <div class="ktkq-preset-name">
                                    ${p.favorite ? '⭐ ' : ''}${p.name}
                                </div>
                                <div class="ktkq-preset-coords">${parseFloat(p.latitude).toFixed(4)}, ${parseFloat(p.longitude).toFixed(4)}</div>
                            </div>
                            <div class="ktkq-preset-btns">
                                <button data-action="favorite" data-index="${globalIndex}" title="${p.favorite ? '取消收藏' : '收藏'}">
                                    ${p.favorite ? '⭐' : '☆'}
                                </button>
                                <button data-action="edit" data-index="${globalIndex}" title="编辑">✏️</button>
                                <button data-action="move-up" data-index="${globalIndex}" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
                                <button data-action="move-down" data-index="${globalIndex}" title="下移" ${index === items.length - 1 ? 'disabled' : ''}>↓</button>
                                <button data-action="delete" data-index="${globalIndex}" title="删除">🗑️</button>
                            </div>
                        </div>
                    `}).join('')}
                </div>
            `).join('');
            
            // 绑定事件委托
            this.bindPresetEvents();
            
            // 渲染快速切换按钮
            this.renderQuickPresets();
        }
        
        bindPresetEvents() {
            const list = document.getElementById('ktkq-preset-list');
            if (!list) return;
            
            // 移除旧的事件监听器（如果存在）
            const oldList = list.cloneNode(true);
            list.parentNode.replaceChild(oldList, list);
            
            // 使用事件委托
            oldList.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;
                
                const action = target.dataset.action;
                const index = parseInt(target.dataset.index);
                
                e.stopPropagation();
                
                switch(action) {
                    case 'apply':
                        this.applyPreset(index);
                        break;
                    case 'favorite':
                        this.toggleFavorite(index);
                        break;
                    case 'edit':
                        this.editPreset(index);
                        break;
                    case 'move-up':
                        this.movePreset(index, -1);
                        break;
                    case 'move-down':
                        this.movePreset(index, 1);
                        break;
                    case 'delete':
                        this.deletePreset(index);
                        break;
                }
            });
        }
        
        groupPresets(presets) {
            const grouped = {};
            presets.forEach(p => {
                const cat = p.category || 'other';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(p);
            });
            return grouped;
        }
        
        getCategoryName(category) {
            const names = {
                teaching: '📚 教学楼',
                dorm: '🏠 宿舍',
                dining: '🍽️ 食堂',
                library: '📖 图书馆',
                sports: '⚽ 运动场',
                other: '📍 其他'
            };
            return names[category] || names.other;
        }
        
        renderQuickPresets() {
            const container = document.getElementById('ktkq-quick-presets');
            if (!container) return;
            
            const favorites = this.config.presets.filter(p => p.favorite).slice(0, 3);
            
            if (!favorites.length) {
                container.innerHTML = '<div class="ktkq-empty-quick">暂无常用预设</div>';
                return;
            }
            
            container.innerHTML = favorites.map((p) => {
                const globalIndex = this.config.presets.indexOf(p);
                return `
                    <button class="ktkq-quick-preset-btn" data-action="apply-quick" data-index="${globalIndex}">
                        ⭐ ${p.name}
                    </button>
                `;
            }).join('');
            
            // 绑定快速预设按钮事件
            container.querySelectorAll('[data-action="apply-quick"]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const index = parseInt(e.currentTarget.dataset.index);
                    this.applyPreset(index);
                });
            });
        }
        
        applyPreset(index) {
            const preset = this.config.presets[index];
            if (!preset) return;
            
            document.getElementById('ktkq-lat').value = preset.latitude;
            document.getElementById('ktkq-lng').value = preset.longitude;
            this.config.latitude = preset.latitude;
            this.config.longitude = preset.longitude;
            saveConfig(this.config);
            
            // 如果虚拟定位已启用，自动应用坐标
            if (this.config.virtualEnabled) {
                this.applyCoords();
            }
            
            this.showNotification(`✅ 已应用预设: ${preset.name}`, 'success');
        }
        
        editPreset(index) {
            const preset = this.config.presets[index];
            if (!preset) return;
            
            document.getElementById('ktkq-preset-name').value = preset.name;
            document.getElementById('ktkq-preset-category').value = preset.category || 'other';
            document.getElementById('ktkq-preset-lat').value = preset.latitude;
            document.getElementById('ktkq-preset-lng').value = preset.longitude;
            
            // 同步到定位页面
            document.getElementById('ktkq-lat').value = preset.latitude;
            document.getElementById('ktkq-lng').value = preset.longitude;
            
            document.getElementById('ktkq-preset-name').dataset.editIndex = index;
            document.getElementById('ktkq-save-preset').textContent = '更新预设';
            
            // 切换到预设标签页
            this.switchTab('presets');
            this.showNotification('编辑模式，修改后点击"更新预设"', 'info');
        }
        
        toggleFavorite(index) {
            const preset = this.config.presets[index];
            if (!preset) return;
            
            preset.favorite = !preset.favorite;
            saveConfig(this.config);
            this.renderPresets();
            this.showNotification(preset.favorite ? '已添加到常用' : '已取消常用', 'info');
        }
        
        movePreset(index, direction) {
            const newIndex = index + direction;
            if (newIndex < 0 || newIndex >= this.config.presets.length) return;
            
            [this.config.presets[index], this.config.presets[newIndex]] = 
            [this.config.presets[newIndex], this.config.presets[index]];
            
            saveConfig(this.config);
            this.renderPresets();
        }
        
        deletePreset(index) {
            const preset = this.config.presets[index];
            if (!preset) return;
            
            if (!confirm(`确定删除预设"${preset.name}"?`)) return;
            
            this.config.presets.splice(index, 1);
            saveConfig(this.config);
            this.renderPresets();
            this.showNotification('预设已删除', 'info');
        }
        
        exportPresets() {
            if (!this.config.presets.length) {
                this.showNotification('暂无预设可导出', 'warning');
                return;
            }
            
            const data = JSON.stringify(this.config.presets, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `位置预设_${new Date().toLocaleDateString()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.showNotification('预设已导出', 'success');
        }
        
        importPresets() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const presets = JSON.parse(event.target.result);
                        if (!Array.isArray(presets)) {
                            throw new Error('格式错误');
                        }
                        
                        // 合并预设，避免重名
                        presets.forEach(p => {
                            let name = p.name;
                            let counter = 1;
                            while (this.config.presets.some(existing => existing.name === name)) {
                                name = `${p.name} (${counter++})`;
                            }
                            this.config.presets.push({
                                ...p,
                                name,
                                createdAt: Date.now()
                            });
                        });
                        
                        saveConfig(this.config);
                        this.renderPresets();
                        this.showNotification(`成功导入 ${presets.length} 个预设`, 'success');
                    } catch (err) {
                        this.showNotification('导入失败：文件格式错误', 'error');
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        }

        
        toggleNightMode() {
            this.config.nightMode = !this.config.nightMode;
            saveConfig(this.config);
            this.applyNightMode();
            document.getElementById('ktkq-night-switch').classList.toggle('on', this.config.nightMode);
            this.showNotification(`夜间模式已${this.config.nightMode ? '开启' : '关闭'}`, 'info');
        }
        
        applyNightMode() {
            document.documentElement.setAttribute('data-ktkq-night', this.config.nightMode);
        }
        
        openMapPicker() {
            this.log('正在打开地图选点...', 'info');
            this.openMapPickerModal('main');
        }
        
        // 新增：预设页面的地图选点
        openPresetMapPicker() {
            this.log('正在打开预设地图选点...', 'info');
            this.openMapPickerModal('preset');
        }
        
        // 新增：预设页面的获取位置
        getPresetLocation() {
            this.showNotification('正在获取位置...', 'info');
            this.originalGetCurrentPosition(
                (pos) => {
                    const lat = pos.coords.latitude.toFixed(8);
                    const lng = pos.coords.longitude.toFixed(8);
                    document.getElementById('ktkq-preset-lat').value = lat;
                    document.getElementById('ktkq-preset-lng').value = lng;
                    // 同步到定位页面
                    document.getElementById('ktkq-lat').value = lat;
                    document.getElementById('ktkq-lng').value = lng;
                    this.config.latitude = lat;
                    this.config.longitude = lng;
                    saveConfig(this.config);
                    this.showNotification('位置获取成功', 'success');
                },
                (err) => {
                    this.showNotification('定位失败: ' + err.message, 'error');
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        }
        
        loadAMapAPI() {
            return new Promise((resolve, reject) => {
                if (window.AMap) {
                    resolve();
                    return;
                }
                
                const script = document.createElement('script');
                script.src = 'https://webapi.amap.com/maps?v=2.0&key=7bf909742712a9eca7c5e18efa431f9a&plugin=AMap.Geocoder,AMap.Geolocation';
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('地图脚本加载失败'));
                document.head.appendChild(script);
            });
        }
        
        openMapPickerModal(mode = 'main') {
            // 检查高德地图API是否加载
            const AMap = window.AMap || (typeof unsafeWindow !== 'undefined' ? unsafeWindow.AMap : null);
            
            if (!AMap) {
                this.showNotification('高德地图未加载，正在加载...', 'info');
                this.loadAMapAPI().then(() => {
                    this.openMapPickerModal(mode);
                }).catch(err => {
                    this.showNotification('地图加载失败: ' + err.message, 'error');
                });
                return;
            }
            
            // 确定地图中心点
            let centerLng, centerLat, zoom = 16;
            
            // 根据mode决定使用哪个输入框的坐标
            let savedLat, savedLng;
            if (mode === 'preset') {
                savedLat = parseFloat(document.getElementById('ktkq-preset-lat').value || this.config.latitude);
                savedLng = parseFloat(document.getElementById('ktkq-preset-lng').value || this.config.longitude);
            } else {
                savedLat = parseFloat(this.config.latitude);
                savedLng = parseFloat(this.config.longitude);
            }
            
            if (savedLat && savedLng) {
                // 将WGS84坐标转换为GCJ02（高德地图使用的坐标系）
                const gcj = CoordTransform.wgs84ToGcj02(savedLng, savedLat);
                centerLat = gcj.lat;
                centerLng = gcj.lng;
                console.log('[KTKQ] 使用已保存坐标(转GCJ-02):', centerLat.toFixed(6), centerLng.toFixed(6));
            } else {
                // 默认西南民族大学航空港校区位置（WGS84坐标）
                // 航空港校区中心位置
                const defaultWgs = {
                    lat: 30.565641,  // 航空港校区纬度
                    lng: 103.967577  // 航空港校区经度
                };
                // 转换为GCJ02坐标系
                const gcj = CoordTransform.wgs84ToGcj02(defaultWgs.lng, defaultWgs.lat);
                centerLat = gcj.lat;
                centerLng = gcj.lng;
                console.log('[KTKQ] 使用默认坐标(航空港校区):', centerLat.toFixed(6), centerLng.toFixed(6));
            }
            
            // 移除已存在的地图选点UI
            const existingUI = document.querySelector('#ktkq-map-picker-ui');
            if (existingUI) existingUI.remove();
            
            // 创建地图选点模态框
            const modal = document.createElement('div');
            modal.id = 'ktkq-map-picker-ui';
            modal.innerHTML = `
                <div class="ktkq-mpk-overlay"></div>
                <div class="ktkq-mpk-dialog">
                    <div class="ktkq-mpk-header">
                        <span>🗺️ 地图选点</span>
                        <span class="ktkq-mpk-close">&times;</span>
                    </div>
                    <div class="ktkq-mpk-body">
                        <div class="ktkq-mpk-info">
                            <div class="ktkq-mpk-coords">
                                <span>纬度(WGS84): <b id="ktkq-mpk-lat">--</b></span>
                                <span>经度(WGS84): <b id="ktkq-mpk-lng">--</b></span>
                            </div>
                            <div class="ktkq-mpk-addr" id="ktkq-mpk-addr">点击地图或拖动标记选择位置</div>
                        </div>
                        <div class="ktkq-mpk-map" id="ktkq-mpk-map"></div>
                        <div class="ktkq-mpk-tip">💡 选好位置后点击"确认选择"保存坐标</div>
                    </div>
                    <div class="ktkq-mpk-footer">
                        <button class="ktkq-mpk-btn secondary ktkq-mpk-cancel">关闭</button>
                        <button class="ktkq-mpk-btn primary ktkq-mpk-confirm">确认选择</button>
                    </div>
                </div>
            `;
            
            // 添加地图选点样式
            if (!document.querySelector('#ktkq-mpk-style')) {
                const style = document.createElement('style');
                style.id = 'ktkq-mpk-style';
                style.textContent = `
                    #ktkq-map-picker-ui { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10001; display: flex; align-items: center; justify-content: center; animation: ktkqFadeIn 0.3s ease; }
                    .ktkq-mpk-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); }
                    .ktkq-mpk-dialog { position: relative; width: 90%; max-width: 500px; background: #fff; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.4); overflow: hidden; animation: ktkqSlideUp 0.3s ease; }
                    .ktkq-mpk-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; font-size: 17px; font-weight: 600; }
                    .ktkq-mpk-close { font-size: 24px; cursor: pointer; opacity: 0.8; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s; }
                    .ktkq-mpk-close:hover { opacity: 1; background: rgba(255,255,255,0.2); transform: scale(1.1); }
                    .ktkq-mpk-body { padding: 16px; }
                    .ktkq-mpk-info { margin-bottom: 12px; padding: 12px; background: linear-gradient(135deg, #f1f5f9, #e2e8f0); border-radius: 10px; }
                    .ktkq-mpk-coords { display: flex; gap: 20px; font-size: 13px; color: #64748b; margin-bottom: 6px; }
                    .ktkq-mpk-coords b { color: #1e293b; font-family: monospace; font-size: 14px; }
                    .ktkq-mpk-addr { font-size: 12px; color: #667eea; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                    .ktkq-mpk-map { width: 100%; height: 280px; border-radius: 12px; overflow: hidden; border: 2px solid #e2e8f0; }
                    .ktkq-mpk-tip { margin-top: 10px; font-size: 12px; color: #64748b; text-align: center; padding: 8px 12px; background: #f0f9ff; border-radius: 8px; border-left: 3px solid #667eea; }
                    .ktkq-mpk-footer { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
                    .ktkq-mpk-btn { padding: 10px 20px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
                    .ktkq-mpk-btn.secondary { background: #e2e8f0; color: #475569; }
                    .ktkq-mpk-btn.secondary:hover { background: #cbd5e0; }
                    .ktkq-mpk-btn.primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; }
                    .ktkq-mpk-btn.primary:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4); }
                    .ktkq-mpk-btn.primary.saved { background: linear-gradient(135deg, #10b981, #059669); pointer-events: none; }
                    @keyframes ktkqFadeIn { from { opacity: 0; } to { opacity: 1; } }
                    @keyframes ktkqSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
                    
                    [data-ktkq-night="true"] .ktkq-mpk-dialog { background: #1f2937; color: #f9fafb; }
                    [data-ktkq-night="true"] .ktkq-mpk-info { background: linear-gradient(135deg, #374151, #4b5563); }
                    [data-ktkq-night="true"] .ktkq-mpk-coords { color: #9ca3af; }
                    [data-ktkq-night="true"] .ktkq-mpk-coords b { color: #f9fafb; }
                    [data-ktkq-night="true"] .ktkq-mpk-addr { color: #818cf8; }
                    [data-ktkq-night="true"] .ktkq-mpk-map { border-color: #4b5563; }
                    [data-ktkq-night="true"] .ktkq-mpk-tip { background: #1e3a5f; color: #93c5fd; border-left-color: #818cf8; }
                    [data-ktkq-night="true"] .ktkq-mpk-footer { background: #111827; border-top-color: #374151; }
                    [data-ktkq-night="true"] .ktkq-mpk-btn.secondary { background: #374151; color: #f9fafb; }
                    [data-ktkq-night="true"] .ktkq-mpk-btn.secondary:hover { background: #4b5563; }
                `;
                document.head.appendChild(style);
            }
            
            document.body.appendChild(modal);
            
            let selectedGcjLat = centerLat;
            let selectedGcjLng = centerLng;
            let pickerMap = null;
            let marker = null;
            
            // 更新显示的坐标和地址
            const updateDisplay = (gcjLat, gcjLng) => {
                const latEl = document.querySelector('#ktkq-mpk-lat');
                const lngEl = document.querySelector('#ktkq-mpk-lng');
                const addrEl = document.querySelector('#ktkq-mpk-addr');
                
                // 转换为WGS84坐标
                const wgs = CoordTransform.gcj02ToWgs84(gcjLng, gcjLat);
                
                if (latEl) latEl.textContent = wgs.lat.toFixed(6);
                if (lngEl) lngEl.textContent = wgs.lng.toFixed(6);
                
                // 获取地址信息
                if (addrEl && AMap.Geocoder) {
                    AMap.plugin('AMap.Geocoder', () => {
                        new AMap.Geocoder().getAddress([gcjLng, gcjLat], (status, result) => {
                            if (status === 'complete' && result.regeocode) {
                                addrEl.textContent = '📍 ' + result.regeocode.formattedAddress;
                            } else {
                                addrEl.textContent = `WGS84坐标: ${wgs.lat.toFixed(6)}, ${wgs.lng.toFixed(6)}`;
                            }
                        });
                    });
                }
            };
            
            // 初始化地图
            setTimeout(() => {
                const mapDiv = document.querySelector('#ktkq-mpk-map');
                if (!mapDiv) return;
                
                try {
                    pickerMap = new AMap.Map(mapDiv, {
                        zoom: zoom,
                        center: [selectedGcjLng, selectedGcjLat],
                        resizeEnable: true
                    });
                    
                    // 创建可拖动的标记
                    marker = new AMap.Marker({
                        position: [selectedGcjLng, selectedGcjLat],
                        draggable: true,
                        cursor: 'move'
                    });
                    marker.setMap(pickerMap);
                    
                    // 标记拖动事件
                    marker.on('dragend', (e) => {
                        const pos = e.target.getPosition();
                        selectedGcjLng = pos.lng;
                        selectedGcjLat = pos.lat;
                        updateDisplay(selectedGcjLat, selectedGcjLng);
                    });
                    
                    // 地图点击事件
                    pickerMap.on('click', (e) => {
                        selectedGcjLng = e.lnglat.lng;
                        selectedGcjLat = e.lnglat.lat;
                        marker.setPosition([selectedGcjLng, selectedGcjLat]);
                        updateDisplay(selectedGcjLat, selectedGcjLng);
                    });
                    
                    updateDisplay(selectedGcjLat, selectedGcjLng);
                    console.log('[KTKQ] 地图选点已打开');
                } catch (err) {
                    mapDiv.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ef4444;">地图加载失败: ${err.message}</div>`;
                    console.error('[KTKQ] 地图初始化失败:', err);
                }
            }, 150);
            
            // 关闭模态框
            const closeModal = () => {
                if (pickerMap) pickerMap.destroy();
                modal.style.animation = 'ktkqFadeOut 0.2s ease forwards';
                setTimeout(() => modal.remove(), 200);
            };
            
            // 绑定事件
            modal.querySelector('.ktkq-mpk-overlay').onclick = closeModal;
            modal.querySelector('.ktkq-mpk-close').onclick = closeModal;
            modal.querySelector('.ktkq-mpk-cancel').onclick = closeModal;
            
            modal.querySelector('.ktkq-mpk-confirm').onclick = () => {
                const wgs = CoordTransform.gcj02ToWgs84(selectedGcjLng, selectedGcjLat);
                const lat = wgs.lat.toFixed(8);
                const lng = wgs.lng.toFixed(8);
                
                // 根据mode保存到不同的输入框
                if (mode === 'preset') {
                    // 预设页面
                    document.getElementById('ktkq-preset-lat').value = lat;
                    document.getElementById('ktkq-preset-lng').value = lng;
                    // 同步到定位页面
                    document.getElementById('ktkq-lat').value = lat;
                    document.getElementById('ktkq-lng').value = lng;
                } else {
                    // 定位页面
                    document.getElementById('ktkq-lat').value = lat;
                    document.getElementById('ktkq-lng').value = lng;
                    // 同步到预设页面
                    document.getElementById('ktkq-preset-lat').value = lat;
                    document.getElementById('ktkq-preset-lng').value = lng;
                }
                
                this.config.latitude = lat;
                this.config.longitude = lng;
                saveConfig(this.config);
                
                const confirmBtn = modal.querySelector('.ktkq-mpk-confirm');
                confirmBtn.textContent = '✅ 已保存';
                confirmBtn.classList.add('saved');
                
                console.log('[KTKQ] 地图选点保存:', wgs.lat.toFixed(6), wgs.lng.toFixed(6));
                this.showNotification('位置已保存', 'success');
                
                setTimeout(closeModal, 1500);
            };
        }
        
        log(msg, type = 'info') {
            const prefix = '[KTKQ]';
            const styles = {
                info: 'color: #3b82f6',
                success: 'color: #10b981',
                warning: 'color: #f59e0b',
                error: 'color: #ef4444'
            };
            console.log(`%c${prefix} ${msg}`, styles[type] || styles.info);
        }
        
        showNotification(msg, type = 'info') {
            const colors = {
                info: { bg: '#3b82f6', icon: 'ℹ️' },
                success: { bg: '#10b981', icon: '✅' },
                warning: { bg: '#f59e0b', icon: '⚠️' },
                error: { bg: '#ef4444', icon: '❌' }
            };
            const config = colors[type] || colors.info;
            
            const notif = document.createElement('div');
            notif.style.cssText = `
                position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
                background: ${config.bg}; color: white; 
                padding: 14px 24px; border-radius: 12px; 
                z-index: 10001; font-size: 14px; font-weight: 600;
                box-shadow: 0 8px 24px rgba(0,0,0,0.2);
                animation: slideDown 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
                display: flex; align-items: center; gap: 10px;
                backdrop-filter: blur(10px);
            `;
            notif.innerHTML = `<span style="font-size: 18px;">${config.icon}</span><span>${msg}</span>`;
            document.body.appendChild(notif);
            
            setTimeout(() => {
                notif.style.animation = 'slideUp 0.3s ease forwards';
                setTimeout(() => notif.remove(), 300);
            }, 2500);
        }

        
        getHTML() {
            const { latitude, longitude, accuracy, virtualEnabled } = this.config;
            return `
                <button id="ktkq-btn">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M12 2v4m0 12v4m10-10h-4M6 12H2"></path>
                    </svg>
                    <span>SMUPhantom</span>
                </button>
                
                <div id="ktkq-menu">
                    <div class="ktkq-header">
                        <span>📍 SMUPhantom</span>
                        <span id="ktkq-close">&times;</span>
                    </div>
                    
                    <div class="ktkq-tabs">
                        <div class="ktkq-tab active" data-tab="status">
                            <span class="ktkq-tab-icon">📡</span>
                            <span class="ktkq-tab-text">状态</span>
                        </div>
                        <div class="ktkq-tab" data-tab="location">
                            <span class="ktkq-tab-icon">&#x1F4CD;</span>
                            <span class="ktkq-tab-text">定位</span>
                        </div>
                        <div class="ktkq-tab" data-tab="presets">
                            <span class="ktkq-tab-icon">⭐</span>
                            <span class="ktkq-tab-text">预设</span>
                        </div>
                        <div class="ktkq-tab" data-tab="settings">
                            <span class="ktkq-tab-icon">⚙️</span>
                            <span class="ktkq-tab-text">设置</span>
                        </div>
                        <div class="ktkq-tab" data-tab="help">
                            <span class="ktkq-tab-icon">❓</span>
                            <span class="ktkq-tab-text">帮助</span>
                        </div>
                        <div class="ktkq-tab" data-tab="about">
                            <span class="ktkq-tab-icon">ℹ️</span>
                            <span class="ktkq-tab-text">关于</span>
                        </div>
                    </div>
                    
                    <div class="ktkq-content">
                        <div id="ktkq-panel-location" class="ktkq-panel">
                            <!-- 虚拟定位主开关卡片 -->
                            <div class="ktkq-virtual-card ${virtualEnabled ? 'active' : ''}">
                                <div class="ktkq-virtual-card-left">
                                    <div class="ktkq-virtual-icon">${virtualEnabled ? '🟣' : '⚪'}</div>
                                    <div>
                                        <div class="ktkq-virtual-title">虚拟定位</div>
                                        <div id="ktkq-virtual-status" class="ktkq-virtual-subtitle">${virtualEnabled ? '已启用 · 坐标生效中' : '未启用 · 使用真实位置'}</div>
                                    </div>
                                </div>
                                <div id="ktkq-virtual-switch" class="ktkq-switch ${virtualEnabled ? 'on' : ''}"></div>
                            </div>
                            
                            <!-- 坐标输入区 -->
                            <div class="ktkq-coord-card">
                                <div class="ktkq-coord-card-header">
                                    <span class="ktkq-coord-card-title">📌 目标坐标</span>
                                    <button id="ktkq-map-picker" class="ktkq-pill-btn">🗺️ 地图选点</button>
                                </div>
                                <div class="ktkq-coord-inputs">
                                    <div class="ktkq-coord-input-group">
                                        <span class="ktkq-coord-input-label">纬度</span>
                                        <input type="text" id="ktkq-lat" value="${latitude}" placeholder="30.565641">
                                    </div>
                                    <div class="ktkq-coord-input-group">
                                        <span class="ktkq-coord-input-label">经度</span>
                                        <input type="text" id="ktkq-lng" value="${longitude}" placeholder="103.967577">
                                    </div>
                                </div>
                                <div class="ktkq-coord-actions">
                                    <button id="ktkq-get-location" class="ktkq-action-btn">📍 获取真实位置</button>
                                    <button id="ktkq-copy-coords" class="ktkq-action-btn">📋 复制坐标</button>
                                </div>
                                <button id="ktkq-apply" class="ktkq-btn-primary">✅ 应用坐标</button>
                            </div>
                            
                            <!-- 常用位置 -->
                            <div class="ktkq-quick-section">
                                <div class="ktkq-quick-header">
                                    <span class="ktkq-quick-title">⭐ 常用位置</span>
                                    <button class="ktkq-pill-btn" onclick="document.querySelector('[data-tab=presets]').click()">管理 →</button>
                                </div>
                                <div id="ktkq-quick-presets"></div>
                            </div>
                            
                            <!-- 历史记录 -->
                            <div class="ktkq-history-section">
                                <div class="ktkq-quick-header">
                                    <span class="ktkq-quick-title">🕐 最近使用</span>
                                    <button id="ktkq-clear-history" class="ktkq-pill-btn">清空</button>
                                </div>
                                <div id="ktkq-history-list" class="ktkq-history-list"></div>
                            </div>

                            <!-- 刷新按钮 -->
                            <button id="ktkq-refresh-status" class="ktkq-refresh-btn">🔄 刷新页面定位状态</button>
                        </div>
                        
                        <div id="ktkq-panel-status" class="ktkq-panel active">
                            <!-- 虚拟定位快速开关 -->
                            <div id="ktkq-status-virtual-card" class="ktkq-status-virtual-card ${virtualEnabled ? 'active' : ''}">
                                <div class="ktkq-status-virtual-left">
                                    <span id="ktkq-status-virtual-icon">${virtualEnabled ? '🟣' : '⚪'}</span>
                                    <div>
                                        <div class="ktkq-status-virtual-title">虚拟定位</div>
                                        <div id="ktkq-status-virtual-sub" class="ktkq-status-virtual-sub">${virtualEnabled ? '已启用 · 坐标生效中' : '未启用 · 使用真实位置'}</div>
                                    </div>
                                </div>
                                <div id="ktkq-status-virtual-switch" class="ktkq-switch ${virtualEnabled ? 'on' : ''}"></div>
                            </div>

                            <!-- 大状态圆圈 -->
                            <div class="ktkq-status-hero">
                                <div id="ktkq-status-circle" class="ktkq-status-circle idle">
                                    <span id="ktkq-status-circle-icon">⚪</span>
                                </div>
                                <div id="ktkq-status-badge-text" class="ktkq-status-hero-text">未检测</div>
                                <div id="ktkq-status-hero-sub" class="ktkq-status-hero-sub">点击检测按钮获取当前定位信息</div>
                            </div>
                            
                            <!-- 操作按钮 -->
                            <div class="ktkq-status-action-row">
                                <button id="ktkq-detect-location" class="ktkq-status-detect-btn">🔍 立即检测</button>
                                <button id="ktkq-auto-refresh-toggle" class="ktkq-status-auto-btn">
                                    <span id="ktkq-auto-refresh-label">🔄 自动刷新</span>
                                </button>
                            </div>
                            
                            <!-- 信息卡片 -->
                            <div class="ktkq-status-cards">
                                <div class="ktkq-status-card">
                                    <div class="ktkq-status-card-icon">&#x1F310;</div>
                                    <div class="ktkq-status-card-label">定位来源</div>
                                    <div id="ktkq-page-source" class="ktkq-status-card-value">--</div>
                                </div>
                                <div class="ktkq-status-card">
                                    <div class="ktkq-status-card-icon">🎯</div>
                                    <div class="ktkq-status-card-label">精度</div>
                                    <div id="ktkq-page-accuracy" class="ktkq-status-card-value">--</div>
                                </div>
                                <div class="ktkq-status-card">
                                    <div class="ktkq-status-card-icon">🕐</div>
                                    <div class="ktkq-status-card-label">更新时间</div>
                                    <div id="ktkq-page-time" class="ktkq-status-card-value">--</div>
                                </div>
                            </div>
                            
                            <!-- 坐标信息 -->
                            <div class="ktkq-status-coords-box">
                                <div class="ktkq-status-coords-header">
                                    <span>📌 坐标信息</span>
                                    <div style="display:flex;gap:6px;">
                                        <button id="ktkq-status-copy" class="ktkq-status-btn" title="复制坐标">📋 复制</button>
                                        <button id="ktkq-status-use" class="ktkq-status-btn primary" title="填入定位面板">⬆️ 使用</button>
                                    </div>
                                </div>
                                <div class="ktkq-status-coord-row">
                                    <span class="ktkq-status-coord-label">纬度</span>
                                    <span id="ktkq-page-lat" class="ktkq-status-coord-value">--</span>
                                </div>
                                <div class="ktkq-status-coord-row">
                                    <span class="ktkq-status-coord-label">经度</span>
                                    <span id="ktkq-page-lng" class="ktkq-status-coord-value">--</span>
                                </div>
                            </div>
                            
                            <!-- 错误提示 -->
                            <div id="ktkq-status-error-box" class="ktkq-status-error-box" style="display:none;">
                                <span>⚠️</span>
                                <span id="ktkq-status-error-msg"></span>
                            </div>
                        </div>
                        
                        <div id="ktkq-panel-presets" class="ktkq-panel">
                            <!-- 搜索 + 工具栏 -->
                            <div class="ktkq-preset-topbar">
                                <div class="ktkq-preset-search-wrap">
                                    <span class="ktkq-search-icon">🔍</span>
                                    <input type="text" id="ktkq-preset-search" placeholder="搜索预设...">
                                </div>
                                <button class="ktkq-preset-action-btn" data-action="import" title="导入">📤</button>
                                <button class="ktkq-preset-action-btn" data-action="export" title="导出">📥</button>
                            </div>
                            
                            <!-- 新增预设折叠区 -->
                            <div class="ktkq-add-preset-wrap">
                                <button id="ktkq-add-preset-toggle" class="ktkq-add-toggle-btn">
                                    <span>➕ 新增预设</span>
                                    <span id="ktkq-add-toggle-arrow" class="ktkq-toggle-arrow">▼</span>
                                </button>
                                <div id="ktkq-add-preset-body" class="ktkq-add-preset-body" style="display:none;">
                                    <div class="ktkq-preset-form-row">
                                        <input type="text" id="ktkq-preset-name" placeholder="位置名称，如：航空港教学楼">
                                        <select id="ktkq-preset-category">
                                            <option value="teaching">📚 教学楼</option>
                                            <option value="dorm">🏠 宿舍</option>
                                            <option value="dining">🍽️ 食堂</option>
                                            <option value="library">🗺️ 图书馆</option>
                                            <option value="sports">⚽ 运动场</option>
                                            <option value="other">📍 其他</option>
                                        </select>
                                    </div>
                                    <div class="ktkq-preset-form-row">
                                        <input type="text" id="ktkq-preset-lat" placeholder="纬度 30.565641">
                                        <input type="text" id="ktkq-preset-lng" placeholder="经度 103.967577">
                                    </div>
                                    <div class="ktkq-preset-form-btns">
                                        <button id="ktkq-preset-map-picker" class="ktkq-action-btn">🗺️ 地图选点</button>
                                        <button id="ktkq-preset-get-location" class="ktkq-action-btn">📍 获取位置</button>
                                    </div>
                                    <button id="ktkq-save-preset" class="ktkq-btn-primary">💾 保存预设</button>
                                </div>
                            </div>
                            
                            <!-- 预设列表 -->
                            <div id="ktkq-preset-list"></div>
                        </div>
                        
                        <div id="ktkq-panel-settings" class="ktkq-panel">
                            <!-- 定位精度 -->
                            <div class="ktkq-settings-card">
                                <div class="ktkq-settings-card-title-row">
                                    <span class="ktkq-settings-card-title">🎯 定位精度</span>
                                    <span class="ktkq-accuracy-badge"><span id="ktkq-accuracy-val">${accuracy}</span>m</span>
                                </div>
                                <input type="range" id="ktkq-accuracy" min="1" max="100" value="${accuracy}">
                                <div class="ktkq-accuracy-labels">
                                    <span>精确 1m</span>
                                    <span>粗略 100m</span>
                                </div>
                            </div>
                            
                            <!-- 外观 -->
                            <div class="ktkq-settings-card">
                                <div class="ktkq-settings-card-title">🎨 外观</div>
                                <div class="ktkq-settings-row">
                                    <div class="ktkq-settings-row-left">
                                        <span class="ktkq-settings-row-icon">🌙</span>
                                        <div>
                                            <div class="ktkq-settings-row-name">夜间模式</div>
                                            <div class="ktkq-settings-row-desc">深色主题，护眼舒适</div>
                                        </div>
                                    </div>
                                    <div id="ktkq-night-switch" class="ktkq-switch ${this.config.nightMode ? 'on' : ''}"></div>
                                </div>
                            </div>
                            
                            <!-- 快捷键 -->
                            <div class="ktkq-settings-card">
                                <div class="ktkq-settings-card-title">⌨️ 快捷键</div>
                                <div class="ktkq-hotkey-grid">
                                    <div class="ktkq-hotkey-item"><kbd>Ctrl+H</kbd><span>隐藏/显示</span></div>
                                    <div class="ktkq-hotkey-item"><kbd>Ctrl+M</kbd><span>最小化</span></div>
                                    <div class="ktkq-hotkey-item"><kbd>Ctrl+Shift+H</kbd><span>紧急隐藏</span></div>
                                    <div class="ktkq-hotkey-item"><kbd>双击</kbd><span>最小化</span></div>
                                    <div class="ktkq-hotkey-item"><kbd>右键</kbd><span>快捷菜单</span></div>
                                    <div class="ktkq-hotkey-item"><kbd>长按</kbd><span>移动端菜单</span></div>
                                </div>
                            </div>
                            
                            <!-- 数据管理 -->
                            <div class="ktkq-settings-card danger">
                                <div class="ktkq-settings-card-title">⚠️ 数据管理</div>
                                <button id="ktkq-reset-script" class="ktkq-reset-btn">
                                    <span>🔄</span>
                                    <div>
                                        <div class="ktkq-reset-title">恢复初始状态</div>
                                        <div class="ktkq-reset-desc">清除所有配置、预设和历史记录</div>
                                    </div>
                                </button>
                            </div>
                        </div>
                        
                        <div id="ktkq-panel-help" class="ktkq-panel">
                            <div class="ktkq-help-section">
                                <div class="ktkq-help-title">🎯 快速开始</div>
                                <div class="ktkq-help-content">
                                    <div class="ktkq-help-step">
                                        <span class="ktkq-help-step-num">1</span>
                                        <div>
                                            <strong>设置坐标</strong>
                                            <p>在"定位"页面输入坐标，或使用"地图选点"功能选择位置</p>
                                        </div>
                                    </div>
                                    <div class="ktkq-help-step">
                                        <span class="ktkq-help-step-num">2</span>
                                        <div>
                                            <strong>启用虚拟定位</strong>
                                            <p>点击"虚拟定位"开关，系统会自动应用设置的坐标</p>
                                        </div>
                                    </div>
                                    <div class="ktkq-help-step">
                                        <span class="ktkq-help-step-num">3</span>
                                        <div>
                                            <strong>刷新定位</strong>
                                            <p>点击"刷新定位状态"按钮，确保页面感知到新的定位信息</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="ktkq-help-section">
                                <div class="ktkq-help-title">✨ 核心功能</div>
                                <div class="ktkq-help-content">
                                    <div class="ktkq-help-feature">
                                        <span class="ktkq-help-icon">🗺️</span>
                                        <div>
                                            <strong>地图选点</strong>
                                            <p>可视化选择位置，支持拖动标记和点击地图</p>
                                        </div>
                                    </div>
                                    <div class="ktkq-help-feature">
                                        <span class="ktkq-help-icon">⭐</span>
                                        <div>
                                            <strong>位置预设</strong>
                                            <p>保存常用位置，支持分类管理和收藏功能</p>
                                        </div>
                                    </div>
                                    <div class="ktkq-help-feature">
                                        <span class="ktkq-help-icon">🔄</span>
                                        <div>
                                            <strong>刷新定位状态</strong>
                                            <p>手动刷新页面定位，无需启用虚拟定位即可使用</p>
                                        </div>
                                    </div>
                                    <div class="ktkq-help-feature">
                                        <span class="ktkq-help-icon">📋</span>
                                        <div>
                                            <strong>复制坐标</strong>
                                            <p>一键复制坐标信息，包含高德地图链接</p>
                                        </div>
                                    </div>
                                    <div class="ktkq-help-feature">
                                        <span class="ktkq-help-icon">🌙</span>
                                        <div>
                                            <strong>夜间模式</strong>
                                            <p>护眼深色主题，适合夜间使用</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="ktkq-help-section">
                                <div class="ktkq-help-title">⌨️ 快捷操作</div>
                                <div class="ktkq-help-content">
                                    <div class="ktkq-help-shortcut">
                                        <kbd>Ctrl + H</kbd>
                                        <span>隐藏/显示按钮</span>
                                    </div>
                                    <div class="ktkq-help-shortcut">
                                        <kbd>Ctrl + M</kbd>
                                        <span>最小化/还原</span>
                                    </div>
                                    <div class="ktkq-help-shortcut">
                                        <kbd>Ctrl + Shift + H</kbd>
                                        <span>紧急隐藏（3秒）</span>
                                    </div>
                                    <div class="ktkq-help-shortcut">
                                        <kbd>双击按钮</kbd>
                                        <span>切换最小化</span>
                                    </div>
                                    <div class="ktkq-help-shortcut">
                                        <kbd>右键按钮</kbd>
                                        <span>快捷菜单</span>
                                    </div>
                                    <div class="ktkq-help-shortcut">
                                        <kbd>长按按钮</kbd>
                                        <span>移动端快捷菜单</span>
                                    </div>
                                    <div class="ktkq-help-shortcut">
                                        <kbd>三击屏幕</kbd>
                                        <span>移动端恢复显示</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="ktkq-help-section">
                                <div class="ktkq-help-title">💡 使用技巧</div>
                                <div class="ktkq-help-content">
                                    <div class="ktkq-help-tip">
                                        <span class="ktkq-help-tip-icon">💾</span>
                                        <p><strong>保存常用位置：</strong>将教室、宿舍等常去地点保存为预设，下次一键应用</p>
                                    </div>
                                    <div class="ktkq-help-tip">
                                        <span class="ktkq-help-tip-icon">⭐</span>
                                        <p><strong>收藏重要预设：</strong>收藏的预设会显示在"定位"页面的"常用位置"区域</p>
                                    </div>
                                    <div class="ktkq-help-tip">
                                        <span class="ktkq-help-tip-icon">📥</span>
                                        <p><strong>导入导出预设：</strong>可以备份预设或与同学分享位置列表</p>
                                    </div>
                                    <div class="ktkq-help-tip">
                                        <span class="ktkq-help-tip-icon">🎯</span>
                                        <p><strong>精度调整：</strong>在"设置"中调整定位精度，建议设置为10-20米</p>
                                    </div>
                                    <div class="ktkq-help-tip">
                                        <span class="ktkq-help-tip-icon">🔄</span>
                                        <p><strong>定位刷新：</strong>启用/关闭虚拟定位时会自动刷新，点击"应用坐标"也会自动刷新，或手动点击"刷新定位状态"按钮</p>
                                    </div>
                                    <div class="ktkq-help-tip">
                                        <span class="ktkq-help-tip-icon">📋</span>
                                        <p><strong>复制坐标：</strong>使用"复制坐标"功能可快速获取当前位置信息和地图链接</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div id="ktkq-panel-about" class="ktkq-panel">
                            <div class="ktkq-about-header">
                                <div class="ktkq-about-logo">✨</div>
                                <h3>SMUPhantom</h3>
                                <div class="ktkq-version-badge">v3.0.0</div>
                                <p class="ktkq-about-desc">让校园生活更简单、更优雅</p>
                            </div>
                            
                            <div class="ktkq-about-body">
                                <div class="ktkq-about-section">
                                    <div class="ktkq-about-row">
                                        <span class="ktkq-row-label">开发者</span>
                                        <span class="ktkq-row-value">Harena</span>
                                    </div>
                                    <div class="ktkq-about-row">
                                        <span class="ktkq-row-label">最新版本</span>
                                        <span class="ktkq-row-value highlight">v3.0.0</span>
                                    </div>
                                    <div class="ktkq-about-row">
                                        <span class="ktkq-row-label">开源协议</span>
                                        <span class="ktkq-row-value">AGPL-3.0-or-later</span>
                                    </div>
                                </div>

                                <div class="ktkq-about-features">
                                    <div class="ktkq-feature-item">🗺️ 地图选点</div>
                                    <div class="ktkq-feature-item">⭐ 位置预设</div>
                                    <div class="ktkq-feature-item">🌙 夜间模式</div>
                                    <div class="ktkq-feature-item">📍 虚拟定位</div>
                                </div>
                                
                                <a href="https://github.com/HarenaGodz" target="_blank" class="ktkq-github-card">
                                    <div class="ktkq-github-icon">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                                        </svg>
                                    </div>
                                    <div class="ktkq-github-info">
                                        <div class="ktkq-github-title">GitHub</div>
                                        <div class="ktkq-github-desc">查看源码、提交 Issue 或 Star 支持</div>
                                    </div>
                                    <div class="ktkq-github-arrow">→</div>
                                </a>
                                
                                <div class="ktkq-disclaimer-section">
                                    <div class="ktkq-disclaimer-header">
                                        <div class="ktkq-disclaimer-icon">⚠️</div>
                                        <h4>免责声明</h4>
                                    </div>
                                    <div class="ktkq-disclaimer-content">
                                        <h5>📜 使用条款</h5>
                                        <ol>
                                            <li><strong>学习交流目的</strong>：本工具仅供学习交流使用，旨在帮助用户了解自动化脚本的工作原理。</li>
                                            <li><strong>禁止违规使用</strong>：严禁将本工具用于违反学校考勤规定的行为，包括但不限于虚假打卡、代打卡等。</li>
                                            <li><strong>遵守校规校纪</strong>：用户应严格遵守西南民族大学的各项规章制度，按时参加考勤。</li>
                                            <li><strong>自担风险</strong>：使用本工具产生的一切后果由用户自行承担，开发者不承担任何责任。</li>
                                            <li><strong>无担保声明</strong>：本工具按"现状"提供，不提供任何明示或暗示的担保。</li>
                                        </ol>
                                        <div class="ktkq-disclaimer-warning">
                                            <span class="ktkq-warning-icon">🚨</span>
                                            <p><strong>特别提醒</strong>：违规使用可能导致严重后果，请三思而后行！</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="ktkq-about-footer">
                                <p>Designed with ❤️ by Harena</p>
                                <p>© 2024-2026 All Rights Reserved</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        
        injectCSS() {
            const style = document.createElement('style');
            style.textContent = `
                /* ========== 动画定义 ========== */
                @keyframes slideDown { 
                    from { opacity: 0; transform: translateX(-50%) translateY(-20px); } 
                    to { opacity: 1; transform: translateX(-50%) translateY(0); } 
                }
                @keyframes slideUp { 
                    from { opacity: 1; transform: translateX(-50%) translateY(0); } 
                    to { opacity: 0; transform: translateX(-50%) translateY(-20px); } 
                }
                @keyframes menuShow { 
                    from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); } 
                    to { opacity: 1; transform: translate(-50%, -50%) scale(1); } 
                }
                @keyframes pulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                }
                @keyframes shimmer {
                    0% { background-position: -1000px 0; }
                    100% { background-position: 1000px 0; }
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes slideUpFromBottom {
                    from { transform: translateY(100%); }
                    to { transform: translateY(0); }
                }
                @keyframes rotate {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-5px); }
                }
                @keyframes glow {
                    0%, 100% { box-shadow: 0 0 5px rgba(102, 126, 234, 0.5), 0 0 10px rgba(102, 126, 234, 0.3); }
                    50% { box-shadow: 0 0 20px rgba(102, 126, 234, 0.8), 0 0 30px rgba(102, 126, 234, 0.5); }
                }
                @keyframes gradientShift {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                
                /* ========== 移动端优化 ========== */
                @media (max-width: 768px) {
                    #ktkq-btn {
                        padding: 12px 18px;
                        font-size: 15px;
                        gap: 8px;
                        touch-action: none;
                        -webkit-tap-highlight-color: transparent;
                    }
                    
                    #ktkq-menu {
                        width: 100vw;
                        max-width: 100vw;
                        height: 100vh;
                        max-height: 100vh;
                        border-radius: 0;
                        top: 0;
                        left: 0;
                        transform: none;
                    }
                    
                    .ktkq-content {
                        padding: 16px;
                        padding-bottom: calc(env(safe-area-inset-bottom) + 16px);
                    }
                    
                    .ktkq-section input[type="text"],
                    .ktkq-section select {
                        font-size: 16px; /* 防止iOS自动缩放 */
                        padding: 14px 16px;
                    }
                    
                    .ktkq-btns button {
                        padding: 14px;
                        font-size: 14px;
                        min-height: 48px; /* 更大的触摸区域 */
                    }
                    
                    .ktkq-btn-primary {
                        padding: 16px;
                        font-size: 16px;
                        min-height: 52px;
                    }
                    
                    .ktkq-preset-btns button {
                        padding: 10px 12px;
                        font-size: 16px;
                        min-width: 44px; /* iOS推荐的最小触摸尺寸 */
                        min-height: 44px;
                    }
                    
                    .ktkq-quick-preset-btn {
                        padding: 16px 20px;
                        font-size: 15px;
                        min-height: 52px;
                    }
                    
                    .ktkq-preset-toolbar input {
                        font-size: 16px;
                        padding: 12px 16px;
                    }
                    
                    .ktkq-preset-toolbar button {
                        padding: 12px 16px;
                        font-size: 20px;
                        min-width: 52px;
                        min-height: 52px;
                    }
                    
                    .ktkq-preset-action-btn {
                        padding: 12px 16px !important;
                        min-width: auto !important;
                        min-height: 52px !important;
                    }
                    .ktkq-preset-action-btn .ktkq-btn-text {
                        font-size: 14px !important;
                    }
                    
                    .ktkq-tab {
                        padding: 14px;
                        font-size: 15px;
                        min-height: 48px;
                    }
                    
                    #ktkq-close {
                        font-size: 36px;
                        width: 44px;
                        height: 44px;
                    }
                    
                    .ktkq-switch {
                        width: 56px;
                        height: 32px;
                    }
                    
                    .ktkq-switch::after {
                        width: 26px;
                        height: 26px;
                        top: 3px;
                        left: 3px;
                    }
                    
                    .ktkq-switch.on::after {
                        transform: translateX(24px);
                    }
                    
                    /* 移动端预设项优化 */
                    .ktkq-preset-item {
                        padding: 12px 14px;
                        gap: 8px;
                        flex-wrap: wrap;
                        align-items: flex-start;
                    }
                    
                    .ktkq-preset-drag {
                        align-self: center;
                        flex-shrink: 0;
                    }
                    
                    .ktkq-preset-info {
                        flex: 1;
                        min-width: 0;
                        width: calc(100% - 40px);
                    }
                    
                    .ktkq-preset-name {
                        font-size: 14px;
                        white-space: normal;
                        word-break: break-all;
                        overflow: visible;
                        text-overflow: unset;
                    }
                    
                    .ktkq-preset-coords {
                        font-size: 12px;
                        white-space: normal;
                        word-break: break-all;
                    }
                    
                    .ktkq-preset-btns {
                        width: 100%;
                        display: flex;
                        justify-content: flex-end;
                        gap: 8px;
                        margin-top: 4px;
                        padding-left: 28px;
                    }
                    
                    .ktkq-preset-btns button {
                        flex: 1;
                        max-width: 52px;
                        min-width: 40px;
                        min-height: 40px;
                        padding: 8px;
                        font-size: 15px;
                    }
                    
                    /* 移动端快捷键说明隐藏 */
                    .ktkq-hotkey-list {
                        display: none;
                    }
                    
                    /* 添加移动端提示 */
                    #ktkq-panel-settings::after {
                        content: '💡 提示：长按按钮显示菜单 | 快速三击屏幕恢复隐藏';
                        display: block;
                        padding: 16px;
                        margin-top: 16px;
                        background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
                        border-radius: 12px;
                        border: 2px solid #fbbf24;
                        color: #92400e;
                        font-size: 13px;
                        text-align: center;
                        font-weight: 600;
                        line-height: 1.6;
                    }
                }
                
                /* ========== 超小屏幕优化 ========== */
                @media (max-width: 375px) {
                    .ktkq-preset-btns {
                        gap: 4px;
                    }
                    
                    .ktkq-preset-btns button {
                        padding: 7px;
                        min-width: 36px;
                        min-height: 36px;
                        font-size: 13px;
                    }
                }
                
                /* ========== 横屏优化 ========== */
                @media (max-height: 500px) and (orientation: landscape) {
                    #ktkq-menu {
                        max-height: 100vh;
                    }
                    
                    .ktkq-content {
                        padding: 12px;
                    }
                    
                    .ktkq-section {
                        margin-bottom: 12px;
                    }
                }
                
                /* ========== 浮动按钮 ========== */
                #ktkq-btn {
                    position: fixed; z-index: 9999;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; border: none; border-radius: 50px;
                    padding: 14px 24px; font-size: 14px; font-weight: 600;
                    cursor: grab; display: flex; align-items: center; gap: 10px;
                    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4), 
                                0 4px 12px rgba(118, 75, 162, 0.3);
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    user-select: none; touch-action: none;
                    backdrop-filter: blur(10px);
                    animation: bounce 2s ease-in-out infinite;
                }
                #ktkq-btn::before {
                    content: ''; position: absolute; inset: -2px;
                    border-radius: 50px; padding: 2px;
                    background: linear-gradient(135deg, 
                        rgba(255,255,255,0.4), 
                        rgba(255,255,255,0.1),
                        rgba(255,255,255,0.4));
                    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                    -webkit-mask-composite: xor; mask-composite: exclude;
                    opacity: 0; transition: opacity 0.3s;
                    animation: rotate 3s linear infinite;
                }
                #ktkq-btn:hover {
                    transform: translateY(-4px) scale(1.05);
                    box-shadow: 0 12px 32px rgba(102, 126, 234, 0.5),
                                0 6px 16px rgba(118, 75, 162, 0.4);
                    animation: none;
                }
                #ktkq-btn:hover::before { opacity: 1; }
                #ktkq-btn:active { 
                    transform: translateY(-2px) scale(0.98); 
                    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
                }
                #ktkq-btn.dragging { 
                    cursor: grabbing; 
                    transform: scale(0.95) rotate(5deg); 
                    box-shadow: 0 16px 40px rgba(102, 126, 234, 0.6);
                    animation: none;
                }
                #ktkq-btn svg {
                    animation: pulse 2s ease-in-out infinite;
                    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
                }
                
                /* ========== 最小化状态 ========== */
                #ktkq-btn.minimized {
                    padding: 8px 12px;
                    font-size: 12px;
                    gap: 6px;
                }
                #ktkq-btn.minimized svg {
                    width: 16px;
                    height: 16px;
                }
                #ktkq-btn.minimized span {
                    display: none;
                }
                
                /* ========== 快捷菜单 ========== */
                #ktkq-quick-menu {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                [data-ktkq-night="true"] #ktkq-quick-menu {
                    background: #1f2937;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
                }
                [data-ktkq-night="true"] .ktkq-quick-menu-item {
                    color: #f9fafb !important;
                }
                [data-ktkq-night="true"] .ktkq-quick-menu-item:hover {
                    background: #374151 !important;
                }
                
                /* ========== 快捷键列表 ========== */
                .ktkq-hotkey-list {
                    display: flex; flex-direction: column; gap: 10px;
                }
                
                .ktkq-hotkey-item {
                    display: flex; justify-content: space-between;
                    align-items: center; padding: 12px 14px;
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    border-radius: 10px; border: 1px solid #e5e7eb;
                    transition: all 0.2s;
                }
                .ktkq-hotkey-item:hover {
                    transform: translateX(4px);
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                }
                
                .ktkq-hotkey-key {
                    font-family: 'Courier New', monospace;
                    font-size: 12px; font-weight: 700;
                    color: white; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 6px 12px; border-radius: 6px;
                    box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);
                    white-space: nowrap;
                }
                
                .ktkq-hotkey-desc {
                    font-size: 13px; color: #6b7280;
                    text-align: right; flex: 1; margin-left: 12px;
                }
                
                [data-ktkq-night="true"] .ktkq-hotkey-item {
                    background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
                    border-color: #4b5563;
                }
                [data-ktkq-night="true"] .ktkq-hotkey-desc {
                    color: #d1d5db;
                }
                
                /* ========== 主菜单 ========== */
                #ktkq-menu {
                    position: fixed; top: 50%; left: 50%; 
                    transform: translate(-50%, -50%);
                    width: 400px; max-width: 92vw; max-height: 85vh;
                    background: white; border-radius: 24px; z-index: 10000;
                    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.25), 
                                0 10px 40px rgba(102, 126, 234, 0.2),
                                0 0 0 1px rgba(0, 0, 0, 0.05);
                    display: none; flex-direction: column; overflow: hidden;
                    backdrop-filter: blur(20px);
                    border: 2px solid rgba(255, 255, 255, 0.8);
                }
                #ktkq-menu.show { 
                    display: flex; 
                    animation: menuShow 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); 
                }
                
                /* 菜单背景装饰 */
                #ktkq-menu::before {
                    content: '';
                    position: absolute;
                    top: -50%;
                    right: -50%;
                    width: 200%;
                    height: 200%;
                    background: radial-gradient(circle, rgba(102, 126, 234, 0.05) 0%, transparent 70%);
                    pointer-events: none;
                    animation: rotate 20s linear infinite;
                }
                
                /* ========== 头部 ========== */
                .ktkq-header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    background-size: 200% 200%;
                    animation: gradientShift 6s ease infinite;
                    color: white; padding: 20px 24px;
                    display: flex; justify-content: space-between; align-items: center;
                    position: relative; overflow: hidden;
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
                }
                .ktkq-header::before {
                    content: ''; position: absolute; inset: 0;
                    background: linear-gradient(90deg, 
                        transparent, 
                        rgba(255,255,255,0.15), 
                        transparent);
                    animation: shimmer 3s infinite;
                }
                .ktkq-header::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 3px;
                    background: linear-gradient(90deg, 
                        transparent,
                        rgba(255,255,255,0.5),
                        transparent);
                }
                .ktkq-header span:first-child {
                    font-size: 18px; font-weight: 700;
                    text-shadow: 0 2px 8px rgba(0,0,0,0.2);
                    position: relative;
                    z-index: 1;
                }
                #ktkq-close { 
                    font-size: 32px; cursor: pointer; line-height: 1;
                    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); 
                    opacity: 0.9;
                    width: 36px; height: 36px; display: flex;
                    align-items: center; justify-content: center;
                    border-radius: 50%;
                    position: relative;
                    z-index: 1;
                }
                #ktkq-close:hover { 
                    opacity: 1; 
                    background: rgba(255,255,255,0.25);
                    transform: rotate(90deg) scale(1.1);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                #ktkq-close:active {
                    transform: rotate(90deg) scale(0.95);
                }
                
                /* ========== 标签页 ========== */
                .ktkq-tabs {
                    display: flex; 
                    background: linear-gradient(to bottom, #f9fafb, #ffffff); 
                    border-bottom: 2px solid #e5e7eb;
                    position: relative;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                }
                .ktkq-tab {
                    flex: 1; padding: 10px 4px 8px; text-align: center; cursor: pointer;
                    color: #9ca3af; font-size: 11px; font-weight: 600;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
                    position: relative;
                    display: flex; flex-direction: column; align-items: center; gap: 3px;
                    background: transparent;
                }
                .ktkq-tab-icon { font-size: 16px; line-height: 1; }
                .ktkq-tab-text { font-size: 10px; font-weight: 600; letter-spacing: 0.3px; }
                .ktkq-tab::after {
                    content: ''; position: absolute; bottom: -2px; left: 10%; right: 10%;
                    height: 3px; 
                    background: linear-gradient(90deg, #667eea, #764ba2);
                    border-radius: 2px 2px 0 0;
                    transform: scaleX(0); 
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .ktkq-tab:hover { color: #667eea; }
                .ktkq-tab.active { color: #667eea; }
                .ktkq-tab.active .ktkq-tab-icon { filter: drop-shadow(0 2px 4px rgba(102,126,234,0.4)); }
                .ktkq-tab.active::after { transform: scaleX(1); }
                
                /* ========== 内容区域 ========== */
                .ktkq-content { 
                    flex: 1; overflow-y: auto; padding: 24px;
                    scrollbar-width: thin;
                    scrollbar-color: #d1d5db #f9fafb;
                }
                .ktkq-content::-webkit-scrollbar { width: 6px; }
                .ktkq-content::-webkit-scrollbar-track { background: #f9fafb; }
                .ktkq-content::-webkit-scrollbar-thumb { 
                    background: #d1d5db; border-radius: 3px; 
                }
                .ktkq-content::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
                
                .ktkq-panel { 
                    display: none; 
                    animation: fadeIn 0.3s ease;
                }
                .ktkq-panel.active { display: block; }
                
                /* ========== 区块 ========== */
                .ktkq-section { 
                    margin-bottom: 20px;
                    animation: fadeIn 0.5s ease;
                    position: relative;
                }
                .ktkq-section label { 
                    display: block; margin-bottom: 10px; 
                    font-size: 13px; font-weight: 700; color: #374151;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    position: relative;
                    padding-left: 12px;
                }
                .ktkq-section label::before {
                    content: '';
                    position: absolute;
                    left: 0;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 4px;
                    height: 16px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    border-radius: 2px;
                }
                
                /* ========== 定位面板新组件 ========== */
                .ktkq-virtual-card {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 16px 18px;
                    background: linear-gradient(135deg, #f9fafb, #f3f4f6);
                    border: 2px solid #e5e7eb;
                    border-radius: 16px;
                    margin-bottom: 14px;
                    transition: all 0.3s ease;
                }
                .ktkq-virtual-card.active {
                    background: linear-gradient(135deg, #ede9fe, #ddd6fe);
                    border-color: #a78bfa;
                    box-shadow: 0 4px 16px rgba(139,92,246,0.15);
                }
                .ktkq-virtual-card-left { display: flex; align-items: center; gap: 12px; }
                .ktkq-virtual-icon { font-size: 28px; line-height: 1; }
                .ktkq-virtual-title { font-size: 15px; font-weight: 700; color: #1f2937; }
                .ktkq-virtual-subtitle { font-size: 12px; color: #6b7280; margin-top: 2px; }
                .ktkq-virtual-card.active .ktkq-virtual-title { color: #5b21b6; }
                .ktkq-virtual-card.active .ktkq-virtual-subtitle { color: #7c3aed; }
                
                .ktkq-coord-card {
                    background: white;
                    border: 2px solid #e5e7eb;
                    border-radius: 16px;
                    padding: 16px;
                    margin-bottom: 14px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
                }
                .ktkq-coord-card-header {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 12px;
                }
                .ktkq-coord-card-title { font-size: 13px; font-weight: 700; color: #374151; }
                .ktkq-pill-btn {
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white; border: none; padding: 6px 12px;
                    border-radius: 20px; font-size: 12px; font-weight: 600;
                    cursor: pointer; transition: all 0.2s;
                }
                .ktkq-pill-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(102,126,234,0.35); }
                
                .ktkq-coord-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
                .ktkq-coord-input-group { display: flex; flex-direction: column; gap: 4px; }
                .ktkq-coord-input-label { font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
                .ktkq-coord-input-group input {
                    padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 10px;
                    font-size: 13px; font-family: 'Courier New', monospace;
                    background: #f9fafb; transition: all 0.2s; width: 100%; box-sizing: border-box;
                }
                .ktkq-coord-input-group input:focus {
                    outline: none; border-color: #667eea; background: white;
                    box-shadow: 0 0 0 3px rgba(102,126,234,0.1);
                }
                
                .ktkq-coord-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
                .ktkq-action-btn {
                    padding: 10px; border: 2px solid #e5e7eb; border-radius: 10px;
                    background: #f9fafb; color: #374151; font-size: 12px; font-weight: 600;
                    cursor: pointer; transition: all 0.2s; text-align: center;
                }
                .ktkq-action-btn:hover { border-color: #667eea; background: white; transform: translateY(-1px); box-shadow: 0 3px 8px rgba(0,0,0,0.08); }
                
                .ktkq-quick-section { margin-bottom: 14px; }
                .ktkq-quick-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
                .ktkq-quick-title { font-size: 13px; font-weight: 700; color: #374151; }
                
                .ktkq-refresh-btn {
                    width: 100%; padding: 12px; border: 2px dashed #10b981; border-radius: 12px;
                    background: linear-gradient(135deg, #ecfdf5, #d1fae5);
                    color: #065f46; font-size: 13px; font-weight: 700;
                    cursor: pointer; transition: all 0.2s;
                }
                .ktkq-refresh-btn:hover { background: linear-gradient(135deg, #d1fae5, #a7f3d0); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(16,185,129,0.2); }
                
                /* ========== 状态面板新组件 ========== */
                .ktkq-status-hero {
                    display: flex; flex-direction: column; align-items: center;
                    padding: 24px 16px 20px;
                    background: linear-gradient(135deg, #f9fafb, #f3f4f6);
                    border-radius: 16px; margin-bottom: 14px;
                    border: 2px solid #e5e7eb;
                }
                .ktkq-status-circle {
                    width: 72px; height: 72px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 32px; margin-bottom: 12px;
                    transition: all 0.4s ease;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
                }
                .ktkq-status-circle.idle { background: #f3f4f6; border: 3px solid #d1d5db; }
                .ktkq-status-circle.loading { background: #fef3c7; border: 3px solid #fbbf24; animation: pulse 1s infinite; }
                .ktkq-status-circle.success { background: #d1fae5; border: 3px solid #34d399; box-shadow: 0 4px 20px rgba(52,211,153,0.3); }
                .ktkq-status-circle.error { background: #fee2e2; border: 3px solid #f87171; box-shadow: 0 4px 20px rgba(248,113,113,0.3); }
                .ktkq-status-hero-text { font-size: 16px; font-weight: 700; color: #1f2937; margin-bottom: 4px; }
                .ktkq-status-hero-sub { font-size: 12px; color: #9ca3af; text-align: center; }
                
                .ktkq-status-action-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
                .ktkq-status-detect-btn {
                    padding: 12px; border: none; border-radius: 12px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white; font-size: 13px; font-weight: 700;
                    cursor: pointer; transition: all 0.2s;
                    box-shadow: 0 4px 12px rgba(102,126,234,0.3);
                }
                .ktkq-status-detect-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(102,126,234,0.4); }
                .ktkq-status-auto-btn {
                    padding: 12px; border: 2px solid #e5e7eb; border-radius: 12px;
                    background: #f9fafb; color: #374151; font-size: 13px; font-weight: 700;
                    cursor: pointer; transition: all 0.2s;
                }
                .ktkq-status-auto-btn:hover { border-color: #10b981; background: #ecfdf5; color: #065f46; }
                .ktkq-status-auto-btn.active { background: linear-gradient(135deg, #10b981, #059669); color: white; border-color: #10b981; box-shadow: 0 4px 12px rgba(16,185,129,0.3); }
                
                .ktkq-status-cards {
                    display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px;
                }
                .ktkq-status-card {
                    background: #f9fafb; border: 1.5px solid #e5e7eb; border-radius: 12px;
                    padding: 12px 8px; display: flex; flex-direction: column;
                    align-items: center; gap: 4px; text-align: center; transition: all 0.2s;
                }
                .ktkq-status-card:hover { border-color: #667eea; background: white; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
                .ktkq-status-card-icon { font-size: 18px; }
                .ktkq-status-card-label { font-size: 10px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
                .ktkq-status-card-value { font-size: 12px; color: #1f2937; font-weight: 700; font-family: 'Courier New', monospace; word-break: break-all; }
                
                .ktkq-status-coords-box {
                    background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
                    border: 1.5px solid #7dd3fc; border-radius: 12px;
                    padding: 14px; margin-bottom: 12px;
                }
                .ktkq-status-coords-header {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 10px; font-size: 13px; font-weight: 700; color: #0c4a6e;
                }
                .ktkq-status-btn {
                    background: #e0f2fe; color: #0369a1; border: none;
                    padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600;
                    cursor: pointer; transition: all 0.2s;
                }
                .ktkq-status-btn:hover { background: #bae6fd; transform: translateY(-1px); }
                .ktkq-status-btn.primary { background: linear-gradient(135deg, #667eea, #764ba2); color: white; }
                .ktkq-status-btn.primary:hover { box-shadow: 0 4px 10px rgba(102,126,234,0.35); }
                .ktkq-status-coord-row {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 7px 0; border-bottom: 1px solid #bae6fd;
                }
                .ktkq-status-coord-row:last-child { border-bottom: none; }
                .ktkq-status-coord-label { font-size: 12px; color: #0369a1; font-weight: 600; }
                .ktkq-status-coord-value { font-size: 13px; color: #0c4a6e; font-weight: 700; font-family: 'Courier New', monospace; }
                .ktkq-status-error-box {
                    display: flex; align-items: center; gap: 8px;
                    background: #fee2e2; border: 1px solid #fca5a5; border-radius: 10px;
                    padding: 12px 14px; font-size: 13px; color: #991b1b; margin-bottom: 12px;
                }
                
                /* ========== 预设面板新组件 ========== */
                .ktkq-preset-topbar {
                    display: flex; gap: 8px; align-items: center; margin-bottom: 12px;
                }
                .ktkq-preset-search-wrap {
                    flex: 1; position: relative; display: flex; align-items: center;
                }
                .ktkq-search-icon { position: absolute; left: 10px; font-size: 14px; pointer-events: none; }
                .ktkq-preset-search-wrap input {
                    width: 100%; padding: 9px 12px 9px 32px;
                    border: 2px solid #e5e7eb; border-radius: 10px; font-size: 13px;
                    background: #f9fafb; transition: all 0.2s; box-sizing: border-box;
                }
                .ktkq-preset-search-wrap input:focus { outline: none; border-color: #667eea; background: white; box-shadow: 0 0 0 3px rgba(102,126,234,0.1); }
                .ktkq-preset-action-btn {
                    padding: 9px 12px; border: 2px solid #e5e7eb; border-radius: 10px;
                    background: #f9fafb; font-size: 16px; cursor: pointer; transition: all 0.2s;
                    flex-shrink: 0;
                }
                .ktkq-preset-action-btn:hover { border-color: #667eea; background: white; transform: translateY(-1px); }
                
                .ktkq-add-preset-wrap { margin-bottom: 14px; }
                .ktkq-add-toggle-btn {
                    width: 100%; display: flex; justify-content: space-between; align-items: center;
                    padding: 12px 16px; border: 2px dashed #d1d5db; border-radius: 12px;
                    background: #f9fafb; color: #6b7280; font-size: 13px; font-weight: 700;
                    cursor: pointer; transition: all 0.2s;
                }
                .ktkq-add-toggle-btn:hover, .ktkq-add-toggle-btn.open { border-color: #667eea; color: #667eea; background: #f5f3ff; }
                .ktkq-toggle-arrow { font-size: 10px; transition: transform 0.2s; }
                .ktkq-add-preset-body {
                    padding: 14px; border: 2px solid #e5e7eb; border-top: none;
                    border-radius: 0 0 12px 12px; background: white;
                    animation: fadeIn 0.2s ease;
                }
                .ktkq-preset-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
                .ktkq-preset-form-row input, .ktkq-preset-form-row select {
                    padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 10px;
                    font-size: 13px; background: #f9fafb; transition: all 0.2s; width: 100%; box-sizing: border-box;
                }
                .ktkq-preset-form-row input:focus, .ktkq-preset-form-row select:focus { outline: none; border-color: #667eea; background: white; }
                .ktkq-preset-form-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
                
                /* ========== 设置面板新组件 ========== */
                .ktkq-settings-card {
                    background: white; border: 2px solid #e5e7eb; border-radius: 16px;
                    padding: 16px; margin-bottom: 14px;
                }
                .ktkq-settings-card.danger { border-color: #fca5a5; background: #fff5f5; }
                .ktkq-settings-card-title { font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 14px; }
                .ktkq-settings-card.danger .ktkq-settings-card-title { color: #dc2626; }
                
                .ktkq-settings-card-title-row {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 12px;
                }
                .ktkq-accuracy-badge {
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white; padding: 4px 12px; border-radius: 20px;
                    font-size: 13px; font-weight: 700; font-family: 'Courier New', monospace;
                    min-width: 52px; text-align: center;
                }
                .ktkq-accuracy-labels { display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; margin-top: 6px; }
                
                .ktkq-settings-row {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 4px 0;
                }
                .ktkq-settings-row-left { display: flex; align-items: center; gap: 12px; }
                .ktkq-settings-row-icon { font-size: 22px; }
                .ktkq-settings-row-name { font-size: 14px; font-weight: 600; color: #1f2937; }
                .ktkq-settings-row-desc { font-size: 12px; color: #9ca3af; margin-top: 2px; }
                
                .ktkq-hotkey-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
                .ktkq-hotkey-item { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 8px; background: #f9fafb; border-radius: 10px; border: 1px solid #e5e7eb; text-align: center; }
                .ktkq-hotkey-item kbd { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-family: 'Courier New', monospace; font-weight: 700; white-space: nowrap; }
                .ktkq-hotkey-item span { font-size: 11px; color: #6b7280; }
                
                .ktkq-reset-btn {
                    width: 100%; display: flex; align-items: center; gap: 12px;
                    padding: 14px 16px; border: 2px solid #fca5a5; border-radius: 12px;
                    background: white; color: #dc2626; cursor: pointer; transition: all 0.2s;
                    font-size: 14px;
                }
                .ktkq-reset-btn:hover { background: #fee2e2; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(220,38,38,0.15); }
                .ktkq-reset-title { font-size: 14px; font-weight: 700; color: #dc2626; text-align: left; }
                .ktkq-reset-desc { font-size: 12px; color: #ef4444; text-align: left; margin-top: 2px; }
                
                .ktkq-section input[type="text"] {
                    width: 100%; padding: 14px 18px; 
                    border: 2px solid #e5e7eb;
                    border-radius: 14px; font-size: 14px; 
                    margin-bottom: 12px; transition: all 0.3s;
                    background: linear-gradient(to bottom, #ffffff, #f9fafb);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .ktkq-section input[type="text"]:focus {
                    outline: none; 
                    border-color: #667eea;
                    background: white;
                    box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1),
                                0 4px 12px rgba(102, 126, 234, 0.15);
                    transform: translateY(-2px);
                }
                .ktkq-section input[type="range"] { 
                    width: 100%; height: 8px;
                    -webkit-appearance: none; appearance: none;
                    background: linear-gradient(to right, #667eea 0%, #764ba2 100%);
                    border-radius: 4px; outline: none;
                    position: relative;
                    box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
                }
                .ktkq-section input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none; appearance: none;
                    width: 22px; height: 22px; border-radius: 50%;
                    background: white; cursor: pointer;
                    box-shadow: 0 3px 10px rgba(0,0,0,0.2),
                                0 0 0 3px rgba(102, 126, 234, 0.3);
                    transition: all 0.2s;
                    border: 2px solid #667eea;
                }
                .ktkq-section input[type="range"]::-webkit-slider-thumb:hover {
                    transform: scale(1.2);
                    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.5),
                                0 0 0 4px rgba(102, 126, 234, 0.2);
                }
                .ktkq-section input[type="range"]::-webkit-slider-thumb:active {
                    transform: scale(1.1);
                }
                .ktkq-section select {
                    width: 100%; padding: 14px 18px; 
                    border: 2px solid #e5e7eb;
                    border-radius: 14px; font-size: 14px; 
                    margin-bottom: 12px; 
                    background: linear-gradient(to bottom, #ffffff, #f9fafb);
                    cursor: pointer; transition: all 0.3s;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .ktkq-section select:focus {
                    outline: none; border-color: #667eea;
                    background: white;
                    box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1),
                                0 4px 12px rgba(102, 126, 234, 0.15);
                    transform: translateY(-2px);
                }
                
                /* ========== 开关行 ========== */
                .ktkq-switch-row {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 18px 20px; 
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    border-radius: 14px; 
                    border: 2px solid #e5e7eb;
                    transition: all 0.3s;
                    position: relative;
                    overflow: hidden;
                }
                .ktkq-switch-row::before {
                    content: '';
                    position: absolute;
                    left: 0;
                    top: 0;
                    bottom: 0;
                    width: 4px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    transform: scaleY(0);
                    transition: transform 0.3s;
                }
                .ktkq-switch-row:hover {
                    border-color: #d1d5db;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                    transform: translateX(4px);
                }
                .ktkq-switch-row:hover::before {
                    transform: scaleY(1);
                }
                .ktkq-switch-row > span:first-child {
                    font-weight: 700; color: #374151;
                    font-size: 14px;
                }
                .ktkq-switch-row > div { 
                    display: flex; align-items: center; gap: 14px; 
                }
                .ktkq-switch-row span:last-child { 
                    font-size: 13px; color: #6b7280; font-weight: 600;
                }
                
                /* ========== 开关 ========== */
                .ktkq-switch {
                    width: 56px; height: 30px; background: #d1d5db;
                    border-radius: 15px; position: relative; cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: inset 0 2px 6px rgba(0,0,0,0.15);
                }
                .ktkq-switch::after {
                    content: ''; position: absolute; top: 3px; left: 3px;
                    width: 24px; height: 24px; background: white;
                    border-radius: 50%; 
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: 0 3px 8px rgba(0,0,0,0.25),
                                0 1px 3px rgba(0,0,0,0.15);
                }
                .ktkq-switch.on { 
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    box-shadow: 0 0 15px rgba(102, 126, 234, 0.4),
                                inset 0 2px 6px rgba(0,0,0,0.1);
                }
                .ktkq-switch.on::after { 
                    transform: translateX(26px);
                    box-shadow: 0 3px 10px rgba(0,0,0,0.3),
                                0 0 8px rgba(255,255,255,0.5);
                }
                .ktkq-switch:hover::after {
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                }
                .ktkq-switch:active::after {
                    width: 28px;
                }
                
                /* ========== 按钮组 ========== */
                .ktkq-btns {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
                    margin-bottom: 12px;
                }
                .ktkq-btns button {
                    padding: 14px 16px; border: none; border-radius: 14px;
                    background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%);
                    color: #374151; font-size: 13px; font-weight: 700;
                    cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    border: 2px solid #e5e7eb;
                    position: relative;
                    overflow: hidden;
                }
                .ktkq-btns button::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1));
                    opacity: 0;
                    transition: opacity 0.3s;
                }
                .ktkq-btns button:hover { 
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    transform: translateY(-3px);
                    box-shadow: 0 6px 16px rgba(0,0,0,0.12);
                    border-color: #667eea;
                }
                .ktkq-btns button:hover::before {
                    opacity: 1;
                }
                .ktkq-btns button:active {
                    transform: translateY(-1px);
                    box-shadow: 0 3px 8px rgba(0,0,0,0.1);
                }
                
                /* 刷新定位状态按钮特殊样式 */
                #ktkq-refresh-status {
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
                    color: white !important;
                    border-color: #10b981 !important;
                    font-size: 14px !important;
                    font-weight: 700 !important;
                    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
                }
                #ktkq-refresh-status::before {
                    background: linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0.1)) !important;
                }
                #ktkq-refresh-status:hover {
                    background: linear-gradient(135deg, #059669 0%, #047857 100%) !important;
                    box-shadow: 0 8px 20px rgba(16, 185, 129, 0.4) !important;
                    transform: translateY(-4px) !important;
                }
                
                /* ========== 主按钮 ========== */
                .ktkq-btn-primary {
                    width: 100%; padding: 16px; border: none; border-radius: 14px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    background-size: 200% 200%;
                    color: white; font-size: 15px; font-weight: 700;
                    cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    box-shadow: 0 6px 16px rgba(102, 126, 234, 0.35);
                    position: relative; overflow: hidden;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                .ktkq-btn-primary::before {
                    content: ''; position: absolute; inset: 0;
                    background: linear-gradient(90deg, 
                        transparent, 
                        rgba(255,255,255,0.25), 
                        transparent);
                    transform: translateX(-100%);
                    transition: transform 0.6s;
                }
                .ktkq-btn-primary::after {
                    content: '';
                    position: absolute;
                    inset: -2px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    border-radius: 14px;
                    z-index: -1;
                    opacity: 0;
                    transition: opacity 0.3s;
                    filter: blur(10px);
                }
                .ktkq-btn-primary:hover { 
                    transform: translateY(-3px);
                    box-shadow: 0 10px 25px rgba(102, 126, 234, 0.45);
                    animation: gradientShift 3s ease infinite;
                }
                .ktkq-btn-primary:hover::before {
                    transform: translateX(100%);
                }
                .ktkq-btn-primary:hover::after {
                    opacity: 0.6;
                }
                .ktkq-btn-primary:active {
                    transform: translateY(-1px);
                    box-shadow: 0 6px 16px rgba(102, 126, 234, 0.35);
                }
                
                /* ========== 空状态 ========== */
                .ktkq-empty {
                    text-align: center; padding: 32px 20px; 
                    color: #9ca3af; font-size: 14px;
                    background: #f9fafb; border-radius: 12px;
                    border: 2px dashed #e5e7eb;
                }
                
                .ktkq-empty-quick {
                    text-align: center; padding: 16px; 
                    color: #9ca3af; font-size: 13px;
                    background: #f9fafb; border-radius: 12px;
                    border: 2px dashed #e5e7eb;
                }
                
                .ktkq-section { margin-bottom: 16px; }
                .ktkq-section label { display: block; margin-bottom: 6px; font-size: 13px; color: #6b7280; }
                .ktkq-section input[type="text"] {
                    width: 100%; padding: 10px; border: 1px solid #d1d5db;
                    border-radius: 8px; font-size: 14px; margin-bottom: 8px;
                }
                .ktkq-section input[type="range"] { width: 100%; }
                
                .ktkq-switch-row {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 12px; background: #f9fafb; border-radius: 8px;
                }
                .ktkq-switch-row > div { display: flex; align-items: center; gap: 8px; }
                .ktkq-switch-row span:last-child { font-size: 12px; color: #6b7280; }
                
                .ktkq-switch {
                    width: 48px; height: 26px; background: #d1d5db;
                    border-radius: 13px; position: relative; cursor: pointer;
                    transition: background 0.3s;
                }
                .ktkq-switch::after {
                    content: ''; position: absolute; top: 2px; left: 2px;
                    width: 22px; height: 22px; background: white;
                    border-radius: 50%; transition: transform 0.3s;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                }
                .ktkq-switch.on { background: #667eea; }
                .ktkq-switch.on::after { transform: translateX(22px); }
                
                .ktkq-btns {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
                    margin-bottom: 8px;
                }
                .ktkq-btns button {
                    padding: 10px; border: none; border-radius: 8px;
                    background: #f3f4f6; color: #374151; font-size: 13px;
                    cursor: pointer; transition: all 0.2s;
                }
                .ktkq-btns button:hover { background: #e5e7eb; }
                
                .ktkq-btn-primary {
                    width: 100%; padding: 12px; border: none; border-radius: 8px;
                    background: #667eea; color: white; font-size: 14px; font-weight: 600;
                    cursor: pointer; transition: all 0.2s;
                }
                .ktkq-btn-primary:hover { background: #5568d3; }
                
                .ktkq-empty {
                    text-align: center; padding: 20px; color: #9ca3af; font-size: 13px;
                }
                
                /* ========== 快速预设 ========== */
                #ktkq-quick-presets {
                    display: flex; flex-direction: column; gap: 10px;
                }
                
                .ktkq-quick-preset-btn {
                    width: 100%; padding: 16px 20px; border: none; 
                    border-radius: 14px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    background-size: 200% 200%;
                    color: white; font-size: 14px; font-weight: 700;
                    cursor: pointer; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    text-align: left; position: relative; overflow: hidden;
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
                    border: 2px solid rgba(255,255,255,0.2);
                }
                .ktkq-quick-preset-btn::before {
                    content: ''; position: absolute; inset: 0;
                    background: linear-gradient(90deg, 
                        transparent, 
                        rgba(255,255,255,0.25), 
                        transparent);
                    transform: translateX(-100%);
                    transition: transform 0.6s;
                }
                .ktkq-quick-preset-btn::after {
                    content: '→';
                    position: absolute;
                    right: 20px;
                    top: 50%;
                    transform: translateY(-50%);
                    font-size: 20px;
                    opacity: 0;
                    transition: all 0.3s;
                }
                .ktkq-quick-preset-btn:hover {
                    transform: translateY(-3px) scale(1.02);
                    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
                    animation: gradientShift 3s ease infinite;
                    padding-right: 50px;
                }
                .ktkq-quick-preset-btn:hover::before {
                    transform: translateX(100%);
                }
                .ktkq-quick-preset-btn:hover::after {
                    opacity: 1;
                    right: 16px;
                }
                .ktkq-quick-preset-btn:active {
                    transform: translateY(-1px) scale(0.98);
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
                }
                
                /* ========== 预设工具栏 ========== */
                .ktkq-preset-toolbar {
                    display: flex; gap: 10px; align-items: center;
                }
                
                .ktkq-preset-toolbar input {
                    flex: 1; padding: 10px 16px; 
                    border: 2px solid #e5e7eb;
                    border-radius: 12px; font-size: 13px;
                    background: #f9fafb; transition: all 0.3s;
                }
                .ktkq-preset-toolbar input:focus {
                    outline: none; border-color: #667eea;
                    background: white;
                    box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
                }
                
                /* 预设坐标按钮组 */
                .ktkq-preset-coord-btns {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                }
                
                .ktkq-coord-btn {
                    padding: 12px 16px;
                    border: none;
                    border-radius: 12px;
                    background: linear-gradient(135deg, #ffffff 0%, #f9fafb 100%);
                    color: #374151;
                    font-size: 13px;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    border: 2px solid #e5e7eb;
                    position: relative;
                    overflow: hidden;
                }
                .ktkq-coord-btn::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1));
                    opacity: 0;
                    transition: opacity 0.3s;
                }
                .ktkq-coord-btn:hover {
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    border-color: #667eea;
                }
                .ktkq-coord-btn:hover::before {
                    opacity: 1;
                }
                .ktkq-coord-btn:active {
                    transform: translateY(0);
                }
                
                .ktkq-preset-action-btn {
                    padding: 10px 16px; border: none; 
                    border-radius: 12px;
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    cursor: pointer; 
                    transition: all 0.3s;
                    border: 2px solid #e5e7eb;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    color: #374151;
                }
                .ktkq-preset-action-btn .ktkq-btn-icon {
                    font-size: 18px;
                }
                .ktkq-preset-action-btn .ktkq-btn-text {
                    font-size: 13px;
                }
                .ktkq-preset-action-btn:hover {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    transform: scale(1.05) translateY(-2px);
                    border-color: #667eea;
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
                }
                .ktkq-preset-action-btn:active {
                    transform: scale(0.98);
                }
                
                /* ========== 预设分组 ========== */
                .ktkq-preset-group {
                    margin-bottom: 20px;
                    animation: fadeIn 0.4s ease;
                }
                
                .ktkq-preset-group-title {
                    font-size: 13px; font-weight: 700; 
                    color: #6b7280; text-transform: uppercase;
                    margin-bottom: 10px; padding-left: 6px;
                    letter-spacing: 0.5px;
                    display: flex; align-items: center; gap: 8px;
                }
                .ktkq-preset-group-title::before {
                    content: ''; width: 4px; height: 16px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 2px;
                }
                
                /* ========== 预设项 ========== */
                .ktkq-preset-item {
                    display: flex; align-items: center; gap: 10px;
                    padding: 14px; background: #f9fafb; 
                    border-radius: 12px; margin-bottom: 10px; 
                    transition: all 0.3s; cursor: pointer;
                    border: 2px solid transparent;
                    position: relative; overflow: hidden;
                }
                .ktkq-preset-item::before {
                    content: ''; position: absolute; left: 0; top: 0; bottom: 0;
                    width: 4px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    transform: scaleY(0); transition: transform 0.3s;
                }
                .ktkq-preset-item:hover {
                    background: white;
                    border-color: #e5e7eb;
                    transform: translateX(4px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                }
                .ktkq-preset-item:hover::before {
                    transform: scaleY(1);
                }
                .ktkq-preset-item.favorite {
                    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
                    border-color: #fbbf24;
                }
                .ktkq-preset-item.favorite::before {
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                }
                
                /* ========== 预设拖拽手柄 ========== */
                .ktkq-preset-drag {
                    cursor: grab; color: #9ca3af; font-size: 18px;
                    user-select: none; transition: all 0.2s;
                    padding: 4px;
                }
                .ktkq-preset-drag:hover {
                    color: #667eea; transform: scale(1.2);
                }
                .ktkq-preset-drag:active {
                    cursor: grabbing;
                }
                
                /* ========== 预设信息 ========== */
                .ktkq-preset-info {
                    flex: 1; cursor: pointer; min-width: 0;
                }
                
                .ktkq-preset-name {
                    font-weight: 600; color: #374151; 
                    margin-bottom: 4px; font-size: 14px;
                    white-space: nowrap; overflow: hidden;
                    text-overflow: ellipsis;
                }
                
                .ktkq-preset-coords {
                    font-size: 11px; color: #6b7280; 
                    font-family: 'Courier New', monospace;
                    opacity: 0.8;
                }
                
                /* ========== 预设按钮组 ========== */
                .ktkq-preset-btns {
                    display: flex; gap: 6px; flex-shrink: 0;
                }
                
                .ktkq-preset-btns button {
                    padding: 8px 10px; border: none; 
                    border-radius: 8px; font-size: 14px; 
                    cursor: pointer; transition: all 0.2s;
                    background: white; min-width: 32px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    border: 1px solid #e5e7eb;
                }
                .ktkq-preset-btns button:hover {
                    transform: scale(1.15) translateY(-2px);
                    box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                    border-color: #667eea;
                }
                .ktkq-preset-btns button:active {
                    transform: scale(0.95);
                }
                .ktkq-preset-btns button:disabled {
                    opacity: 0.3; cursor: not-allowed;
                    transform: none !important;
                    box-shadow: none !important;
                }
                
                /* ========== 夜间模式 ========== */
                [data-ktkq-night="true"] #ktkq-menu { 
                    background: #1f2937; color: #f9fafb; 
                    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6);
                }
                [data-ktkq-night="true"] .ktkq-tabs { 
                    background: #111827; border-bottom-color: #374151; 
                }
                [data-ktkq-night="true"] .ktkq-tab { color: #9ca3af; }
                [data-ktkq-night="true"] .ktkq-tab:hover { background: #1f2937; }
                [data-ktkq-night="true"] .ktkq-tab.active { 
                    color: #818cf8; 
                }
                [data-ktkq-night="true"] .ktkq-section label { color: #d1d5db; }
                [data-ktkq-night="true"] .ktkq-section input[type="text"],
                [data-ktkq-night="true"] .ktkq-section select { 
                    background: #374151; border-color: #4b5563; color: #f9fafb; 
                }
                [data-ktkq-night="true"] .ktkq-section input[type="text"]:focus,
                [data-ktkq-night="true"] .ktkq-section select:focus {
                    background: #4b5563; border-color: #818cf8;
                    box-shadow: 0 0 0 4px rgba(129, 140, 248, 0.2);
                }
                [data-ktkq-night="true"] .ktkq-switch-row { 
                    background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
                    border-color: #4b5563;
                }
                [data-ktkq-night="true"] .ktkq-switch-row > span:first-child {
                    color: #f9fafb;
                }
                [data-ktkq-night="true"] .ktkq-preset-item { 
                    background: #374151; border-color: transparent;
                }
                [data-ktkq-night="true"] .ktkq-preset-item:hover {
                    background: #4b5563; border-color: #6b7280;
                }
                [data-ktkq-night="true"] .ktkq-preset-item.favorite { 
                    background: linear-gradient(135deg, #78350f 0%, #92400e 100%);
                    border-color: #b45309;
                }
                [data-ktkq-night="true"] .ktkq-preset-group-title { color: #d1d5db; }
                [data-ktkq-night="true"] .ktkq-preset-name { color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-preset-btns button { 
                    background: #4b5563; border-color: #6b7280;
                }
                [data-ktkq-night="true"] .ktkq-preset-btns button:hover { 
                    background: #6b7280; border-color: #818cf8;
                }
                [data-ktkq-night="true"] .ktkq-preset-toolbar input { 
                    background: #374151; border-color: #4b5563; color: #f9fafb; 
                }
                [data-ktkq-night="true"] .ktkq-coord-btn {
                    background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
                    border-color: #4b5563;
                    color: #f9fafb;
                }
                [data-ktkq-night="true"] .ktkq-coord-btn:hover {
                    background: linear-gradient(135deg, #4b5563 0%, #6b7280 100%);
                    border-color: #667eea;
                }
                [data-ktkq-night="true"] .ktkq-preset-action-btn { 
                    background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
                    border-color: #4b5563;
                    color: #f9fafb;
                }
                [data-ktkq-night="true"] .ktkq-preset-action-btn:hover { 
                    background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
                    border-color: #818cf8;
                    color: white;
                }
                [data-ktkq-night="true"] .ktkq-empty,
                [data-ktkq-night="true"] .ktkq-empty-quick { 
                    background: #374151; border-color: #4b5563;
                }
                [data-ktkq-night="true"] .ktkq-btns button { 
                    background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
                    color: #f9fafb; border-color: #4b5563;
                }
                [data-ktkq-night="true"] .ktkq-btns button:hover { 
                    background: linear-gradient(135deg, #4b5563 0%, #6b7280 100%);
                }
                [data-ktkq-night="true"] .ktkq-content::-webkit-scrollbar-track { 
                    background: #1f2937; 
                }
                [data-ktkq-night="true"] .ktkq-content::-webkit-scrollbar-thumb { 
                    background: #4b5563; 
                }
                [data-ktkq-night="true"] .ktkq-content::-webkit-scrollbar-thumb:hover { 
                    background: #6b7280; 
                }
                
                /* 夜间模式 - 新组件 */
                [data-ktkq-night="true"] .ktkq-virtual-card { background: linear-gradient(135deg, #374151, #4b5563); border-color: #4b5563; }
                [data-ktkq-night="true"] .ktkq-virtual-card.active { background: linear-gradient(135deg, #3b1f6e, #4c1d95); border-color: #7c3aed; }
                [data-ktkq-night="true"] .ktkq-virtual-title { color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-virtual-subtitle { color: #9ca3af; }
                [data-ktkq-night="true"] .ktkq-virtual-card.active .ktkq-virtual-title { color: #c4b5fd; }
                [data-ktkq-night="true"] .ktkq-virtual-card.active .ktkq-virtual-subtitle { color: #a78bfa; }
                [data-ktkq-night="true"] .ktkq-coord-card { background: #1f2937; border-color: #374151; }
                [data-ktkq-night="true"] .ktkq-coord-card-title { color: #d1d5db; }
                [data-ktkq-night="true"] .ktkq-coord-input-group input { background: #374151; border-color: #4b5563; color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-coord-input-group input:focus { background: #4b5563; border-color: #818cf8; }
                [data-ktkq-night="true"] .ktkq-action-btn { background: #374151; border-color: #4b5563; color: #d1d5db; }
                [data-ktkq-night="true"] .ktkq-action-btn:hover { background: #4b5563; border-color: #818cf8; color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-quick-title { color: #d1d5db; }
                [data-ktkq-night="true"] .ktkq-refresh-btn { background: linear-gradient(135deg, #064e3b, #065f46); border-color: #059669; color: #6ee7b7; }
                [data-ktkq-night="true"] .ktkq-status-hero { background: linear-gradient(135deg, #1f2937, #374151); border-color: #374151; }
                [data-ktkq-night="true"] .ktkq-status-hero-text { color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-status-hero-sub { color: #6b7280; }
                [data-ktkq-night="true"] .ktkq-status-circle.idle { background: #374151; border-color: #4b5563; }
                [data-ktkq-night="true"] .ktkq-status-card { background: #374151; border-color: #4b5563; }
                [data-ktkq-night="true"] .ktkq-status-card:hover { background: #4b5563; border-color: #818cf8; }
                [data-ktkq-night="true"] .ktkq-status-card-label { color: #6b7280; }
                [data-ktkq-night="true"] .ktkq-status-card-value { color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-status-auto-btn { background: #374151; border-color: #4b5563; color: #d1d5db; }
                [data-ktkq-night="true"] .ktkq-status-auto-btn:hover { border-color: #10b981; background: #064e3b; color: #6ee7b7; }
                [data-ktkq-night="true"] .ktkq-status-coords-box { background: linear-gradient(135deg, #0c2a3e, #0c3547); border-color: #0369a1; }
                [data-ktkq-night="true"] .ktkq-status-coords-header { color: #7dd3fc; }
                [data-ktkq-night="true"] .ktkq-status-coord-label { color: #38bdf8; }
                [data-ktkq-night="true"] .ktkq-status-coord-value { color: #bae6fd; }
                [data-ktkq-night="true"] .ktkq-status-coord-row { border-color: #0369a1; }
                [data-ktkq-night="true"] .ktkq-status-btn { background: #1e3a5f; color: #7dd3fc; }
                [data-ktkq-night="true"] .ktkq-status-btn:hover { background: #1e4976; }
                [data-ktkq-night="true"] .ktkq-preset-topbar input { background: #374151; border-color: #4b5563; color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-add-toggle-btn { background: #374151; border-color: #4b5563; color: #9ca3af; }
                [data-ktkq-night="true"] .ktkq-add-toggle-btn:hover, [data-ktkq-night="true"] .ktkq-add-toggle-btn.open { background: #2d1f5e; border-color: #818cf8; color: #a78bfa; }
                [data-ktkq-night="true"] .ktkq-add-preset-body { background: #1f2937; border-color: #374151; }
                [data-ktkq-night="true"] .ktkq-preset-form-row input, [data-ktkq-night="true"] .ktkq-preset-form-row select { background: #374151; border-color: #4b5563; color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-settings-card { background: #1f2937; border-color: #374151; }
                [data-ktkq-night="true"] .ktkq-settings-card.danger { background: #1f1010; border-color: #7f1d1d; }
                [data-ktkq-night="true"] .ktkq-settings-card-title { color: #d1d5db; }
                [data-ktkq-night="true"] .ktkq-settings-row-name { color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-settings-row-desc { color: #6b7280; }
                [data-ktkq-night="true"] .ktkq-hotkey-item { background: #374151; border-color: #4b5563; }
                [data-ktkq-night="true"] .ktkq-hotkey-item span { color: #9ca3af; }
                [data-ktkq-night="true"] .ktkq-accuracy-labels { color: #6b7280; }
                [data-ktkq-night="true"] .ktkq-tab { color: #6b7280; }
                [data-ktkq-night="true"] .ktkq-tab.active { color: #818cf8; }
                
                /* ========== 帮助页面样式 ========== */
                .ktkq-help-section {
                    margin-bottom: 24px;
                    animation: fadeIn 0.4s ease;
                }
                
                .ktkq-help-title {
                    font-size: 16px;
                    font-weight: 700;
                    color: #1f2937;
                    margin-bottom: 16px;
                    padding-bottom: 10px;
                    border-bottom: 3px solid #667eea;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .ktkq-help-content {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                
                /* 步骤样式 */
                .ktkq-help-step {
                    display: flex;
                    gap: 16px;
                    padding: 16px;
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    border-radius: 12px;
                    border-left: 4px solid #667eea;
                    transition: all 0.3s;
                }
                .ktkq-help-step:hover {
                    transform: translateX(4px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                }
                
                .ktkq-help-step-num {
                    flex-shrink: 0;
                    width: 32px;
                    height: 32px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 700;
                    font-size: 16px;
                    box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);
                }
                
                .ktkq-help-step strong {
                    display: block;
                    color: #374151;
                    margin-bottom: 4px;
                    font-size: 14px;
                }
                
                .ktkq-help-step p {
                    color: #6b7280;
                    font-size: 13px;
                    line-height: 1.6;
                    margin: 0;
                }
                
                /* 功能特性样式 */
                .ktkq-help-feature {
                    display: flex;
                    gap: 14px;
                    padding: 14px;
                    background: white;
                    border-radius: 10px;
                    border: 2px solid #e5e7eb;
                    transition: all 0.3s;
                }
                .ktkq-help-feature:hover {
                    border-color: #667eea;
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
                    transform: translateY(-2px);
                }
                
                .ktkq-help-icon {
                    flex-shrink: 0;
                    font-size: 28px;
                    width: 48px;
                    height: 48px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    border-radius: 12px;
                }
                
                .ktkq-help-feature strong {
                    display: block;
                    color: #374151;
                    margin-bottom: 4px;
                    font-size: 14px;
                }
                
                .ktkq-help-feature p {
                    color: #6b7280;
                    font-size: 12px;
                    line-height: 1.5;
                    margin: 0;
                }
                
                /* 快捷键样式 */
                .ktkq-help-shortcut {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 14px;
                    background: white;
                    border-radius: 10px;
                    border: 1px solid #e5e7eb;
                    transition: all 0.2s;
                }
                .ktkq-help-shortcut:hover {
                    background: #f9fafb;
                    border-color: #667eea;
                }
                
                .ktkq-help-shortcut kbd {
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    font-weight: 700;
                    color: white;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 6px 12px;
                    border-radius: 6px;
                    box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);
                    white-space: nowrap;
                }
                
                .ktkq-help-shortcut span {
                    color: #6b7280;
                    font-size: 13px;
                }
                
                /* 提示样式 */
                .ktkq-help-tip {
                    display: flex;
                    gap: 12px;
                    padding: 14px;
                    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
                    border-radius: 10px;
                    border-left: 4px solid #f59e0b;
                }
                
                .ktkq-help-tip-icon {
                    flex-shrink: 0;
                    font-size: 24px;
                }
                
                .ktkq-help-tip p {
                    color: #92400e;
                    font-size: 13px;
                    line-height: 1.6;
                    margin: 0;
                }
                
                .ktkq-help-tip strong {
                    color: #78350f;
                }
                
                /* 警告样式 */
                .ktkq-help-warning {
                    padding: 16px;
                    background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
                    border-radius: 10px;
                    border-left: 4px solid #ef4444;
                }
                
                .ktkq-help-warning p {
                    color: #991b1b;
                    font-size: 13px;
                    line-height: 1.8;
                    margin: 8px 0;
                }
                
                .ktkq-help-warning p:first-child {
                    margin-top: 0;
                }
                
                .ktkq-help-warning p:last-child {
                    margin-bottom: 0;
                }
                
                /* 页脚样式 */
                .ktkq-help-footer {
                    text-align: center;
                    padding: 20px;
                    margin-top: 24px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 12px;
                    color: white;
                }
                
                .ktkq-help-footer p {
                    margin: 6px 0;
                    font-size: 13px;
                    opacity: 0.95;
                }
                
                .ktkq-help-footer p:first-child {
                    font-weight: 700;
                    font-size: 14px;
                }
                
                /* 夜间模式适配 */
                [data-ktkq-night="true"] .ktkq-help-title {
                    color: #f9fafb;
                    border-bottom-color: #818cf8;
                }
                
                [data-ktkq-night="true"] .ktkq-help-step {
                    background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
                    border-left-color: #818cf8;
                }
                
                [data-ktkq-night="true"] .ktkq-help-step strong {
                    color: #f9fafb;
                }
                
                [data-ktkq-night="true"] .ktkq-help-step p {
                    color: #d1d5db;
                }
                
                [data-ktkq-night="true"] .ktkq-help-feature {
                    background: #374151;
                    border-color: #4b5563;
                }
                
                [data-ktkq-night="true"] .ktkq-help-feature:hover {
                    border-color: #818cf8;
                }
                
                [data-ktkq-night="true"] .ktkq-help-icon {
                    background: linear-gradient(135deg, #4b5563 0%, #6b7280 100%);
                }
                
                [data-ktkq-night="true"] .ktkq-help-feature strong {
                    color: #f9fafb;
                }
                
                [data-ktkq-night="true"] .ktkq-help-feature p {
                    color: #d1d5db;
                }
                
                [data-ktkq-night="true"] .ktkq-help-shortcut {
                    background: #374151;
                    border-color: #4b5563;
                }
                
                [data-ktkq-night="true"] .ktkq-help-shortcut:hover {
                    background: #4b5563;
                    border-color: #818cf8;
                }
                
                [data-ktkq-night="true"] .ktkq-help-shortcut span {
                    color: #d1d5db;
                }
                
                [data-ktkq-night="true"] .ktkq-help-tip {
                    background: linear-gradient(135deg, #78350f 0%, #92400e 100%);
                    border-left-color: #f59e0b;
                }
                
                /* ========== 关于页面样式 ========== */
                .ktkq-about-header {
                    text-align: center;
                    padding: 32px 20px 24px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 16px 16px 0 0;
                    color: white;
                    margin: -20px -20px 0;
                }
                
                .ktkq-about-logo {
                    font-size: 56px;
                    margin-bottom: 16px;
                    animation: pulse 2s ease-in-out infinite;
                }
                
                .ktkq-about-header h3 {
                    font-size: 20px;
                    font-weight: 700;
                    margin: 0 0 12px;
                    line-height: 1.4;
                }
                
                .ktkq-version-badge {
                    display: inline-block;
                    padding: 6px 16px;
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 20px;
                    font-size: 13px;
                    font-weight: 600;
                    margin-bottom: 12px;
                    backdrop-filter: blur(10px);
                }
                
                .ktkq-about-desc {
                    font-size: 14px;
                    opacity: 0.95;
                    margin: 0;
                }
                
                .ktkq-about-body {
                    padding: 24px 20px;
                }
                
                .ktkq-about-section {
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    border-radius: 12px;
                    padding: 16px;
                    margin-bottom: 20px;
                }
                
                .ktkq-about-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 0;
                    border-bottom: 1px solid #e5e7eb;
                }
                
                .ktkq-about-row:last-child {
                    border-bottom: none;
                }
                
                .ktkq-row-label {
                    font-size: 14px;
                    color: #6b7280;
                    font-weight: 500;
                }
                
                .ktkq-row-value {
                    font-size: 14px;
                    color: #1f2937;
                    font-weight: 600;
                }
                
                .ktkq-row-value.highlight {
                    color: #667eea;
                }
                
                .ktkq-about-features {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 12px;
                    margin-bottom: 20px;
                }
                
                .ktkq-feature-item {
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    border: 2px solid #e5e7eb;
                    border-radius: 12px;
                    padding: 16px;
                    text-align: center;
                    font-size: 14px;
                    font-weight: 600;
                    color: #374151;
                    transition: all 0.3s ease;
                }
                
                .ktkq-feature-item:hover {
                    transform: translateY(-2px);
                    border-color: #667eea;
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
                }
                
                .ktkq-github-card {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    padding: 16px;
                    background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
                    border-radius: 12px;
                    color: white;
                    text-decoration: none;
                    transition: all 0.3s ease;
                    margin-bottom: 20px;
                }
                
                .ktkq-github-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
                }
                
                .ktkq-github-icon {
                    width: 48px;
                    height: 48px;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                
                .ktkq-github-info {
                    flex: 1;
                }
                
                .ktkq-github-title {
                    font-size: 16px;
                    font-weight: 700;
                    margin-bottom: 4px;
                }
                
                .ktkq-github-desc {
                    font-size: 13px;
                    opacity: 0.8;
                }
                
                .ktkq-github-arrow {
                    font-size: 24px;
                    opacity: 0.6;
                    transition: all 0.3s ease;
                }
                
                .ktkq-github-card:hover .ktkq-github-arrow {
                    transform: translateX(4px);
                    opacity: 1;
                }
                
                .ktkq-disclaimer-section {
                    background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
                    border: 2px solid #fecaca;
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 20px;
                }
                
                .ktkq-disclaimer-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 16px;
                }
                
                .ktkq-disclaimer-icon {
                    font-size: 32px;
                }
                
                .ktkq-disclaimer-header h4 {
                    font-size: 18px;
                    font-weight: 700;
                    color: #991b1b;
                    margin: 0;
                }
                
                .ktkq-disclaimer-content h5 {
                    font-size: 15px;
                    color: #991b1b;
                    margin: 0 0 12px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .ktkq-disclaimer-content ol {
                    margin: 0 0 16px;
                    padding-left: 20px;
                    color: #7f1d1d;
                    font-size: 13px;
                    line-height: 1.8;
                }
                
                .ktkq-disclaimer-content li {
                    margin-bottom: 10px;
                }
                
                .ktkq-disclaimer-content li strong {
                    color: #991b1b;
                }
                
                .ktkq-disclaimer-warning {
                    padding: 14px;
                    background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
                    border-radius: 8px;
                    border-left: 4px solid #ef4444;
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                }
                
                .ktkq-warning-icon {
                    font-size: 20px;
                }
                
                .ktkq-disclaimer-warning p {
                    margin: 0;
                    font-size: 13px;
                    color: #991b1b;
                    line-height: 1.5;
                }
                
                .ktkq-about-footer {
                    text-align: center;
                    padding: 20px;
                    background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                    border-radius: 0 0 16px 16px;
                    margin: 0 -20px -20px;
                }
                
                .ktkq-about-footer p {
                    margin: 6px 0;
                    font-size: 13px;
                    color: #6b7280;
                }
                
                .ktkq-about-footer p:first-child {
                    font-weight: 600;
                    color: #374151;
                }
                
                /* 夜间模式适配 - 关于页面 */
                [data-ktkq-night="true"] .ktkq-about-section {
                    background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
                }
                
                [data-ktkq-night="true"] .ktkq-about-row {
                    border-bottom-color: #4b5563;
                }
                
                [data-ktkq-night="true"] .ktkq-row-label {
                    color: #9ca3af;
                }
                
                [data-ktkq-night="true"] .ktkq-row-value {
                    color: #f9fafb;
                }
                
                [data-ktkq-night="true"] .ktkq-feature-item {
                    background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
                    border-color: #4b5563;
                    color: #f9fafb;
                }
                
                [data-ktkq-night="true"] .ktkq-feature-item:hover {
                    border-color: #818cf8;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-section {
                    background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
                    border-color: #b91c1c;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-header h4 {
                    color: #fecaca;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-content h5 {
                    color: #fecaca;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-content ol {
                    color: #fca5a5;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-content li strong {
                    color: #fecaca;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-warning {
                    background: linear-gradient(135deg, #991b1b 0%, #b91c1c 100%);
                    border-left-color: #dc2626;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-warning p {
                    color: #fca5a5;
                }
                
                [data-ktkq-night="true"] .ktkq-about-footer {
                    background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
                }
                
                [data-ktkq-night="true"] .ktkq-about-footer p {
                    color: #9ca3af;
                }
                
                [data-ktkq-night="true"] .ktkq-about-footer p:first-child {
                    color: #f9fafb;
                }
                
                [data-ktkq-night="true"] .ktkq-help-tip p {
                    color: #fde68a;
                }
                
                [data-ktkq-night="true"] .ktkq-help-tip strong {
                    color: #fef3c7;
                }
                
                [data-ktkq-night="true"] .ktkq-help-warning {
                    background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
                    border-left-color: #ef4444;
                }
                
                [data-ktkq-night="true"] .ktkq-help-warning p {
                    color: #fecaca;
                }
                
                [data-ktkq-night="true"] .ktkq-about-footer p:first-child {
                    color: #f9fafb;
                }
                
                [data-ktkq-night="true"] .ktkq-help-tip p {
                    color: #fde68a;
                }
                
                [data-ktkq-night="true"] .ktkq-help-tip strong {
                    color: #fef3c7;
                }
                
                [data-ktkq-night="true"] .ktkq-help-warning {
                    background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
                    border-left-color: #ef4444;
                }
                
                [data-ktkq-night="true"] .ktkq-help-warning p {
                    color: #fecaca;
                }

                /* ========== 状态页虚拟定位快速开关 ========== */
                .ktkq-status-virtual-card {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 14px 16px; margin-bottom: 12px;
                    background: #f9fafb; border-radius: 14px;
                    border: 2px solid #e5e7eb;
                    transition: all 0.3s;
                }
                .ktkq-status-virtual-card.active {
                    background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
                    border-color: #8b5cf6;
                }
                .ktkq-status-virtual-left {
                    display: flex; align-items: center; gap: 10px;
                }
                .ktkq-status-virtual-left > span {
                    font-size: 22px;
                }
                .ktkq-status-virtual-title {
                    font-weight: 600; font-size: 14px; color: #374151;
                }
                .ktkq-status-virtual-sub {
                    font-size: 12px; color: #6b7280; margin-top: 2px;
                }
                .ktkq-status-virtual-card.active .ktkq-status-virtual-title { color: #5b21b6; }
                .ktkq-status-virtual-card.active .ktkq-status-virtual-sub { color: #7c3aed; }
                [data-ktkq-night="true"] .ktkq-status-virtual-card { background: #374151; border-color: #4b5563; }
                [data-ktkq-night="true"] .ktkq-status-virtual-card.active { background: linear-gradient(135deg, #3b0764 0%, #4c1d95 100%); border-color: #7c3aed; }
                [data-ktkq-night="true"] .ktkq-status-virtual-title { color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-status-virtual-sub { color: #9ca3af; }

                /* ========== 历史记录 ========== */
                .ktkq-history-section {
                    margin-top: 12px;
                }
                .ktkq-history-list {
                    margin-top: 8px; display: flex; flex-direction: column; gap: 6px;
                }
                .ktkq-history-empty {
                    text-align: center; color: #9ca3af; font-size: 13px; padding: 12px;
                }
                .ktkq-history-item {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 10px 12px; background: #f9fafb;
                    border-radius: 10px; border: 1px solid #e5e7eb;
                    transition: all 0.2s;
                }
                .ktkq-history-item:hover { background: white; border-color: #667eea; }
                .ktkq-history-info { flex: 1; min-width: 0; }
                .ktkq-history-name {
                    font-size: 13px; font-weight: 600; color: #374151;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .ktkq-history-coords {
                    font-size: 11px; color: #6b7280; font-family: 'Courier New', monospace;
                    margin-top: 2px;
                }
                .ktkq-history-use-btn {
                    flex-shrink: 0; padding: 5px 10px; border: none;
                    border-radius: 7px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; font-size: 12px; font-weight: 600; cursor: pointer;
                    transition: all 0.2s; margin-left: 8px;
                }
                .ktkq-history-use-btn:hover { transform: scale(1.05); opacity: 0.9; }
                [data-ktkq-night="true"] .ktkq-history-item { background: #374151; border-color: #4b5563; }
                [data-ktkq-night="true"] .ktkq-history-item:hover { background: #4b5563; border-color: #6b7280; }
                [data-ktkq-night="true"] .ktkq-history-name { color: #f9fafb; }
                [data-ktkq-night="true"] .ktkq-history-coords { color: #9ca3af; }

                /* ========== 免责声明弹窗样式 ========== */
                .ktkq-disclaimer-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 10005;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    animation: fadeIn 0.3s ease;
                }
                
                .ktkq-disclaimer-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(8px);
                }
                
                .ktkq-disclaimer-dialog {
                    position: relative;
                    width: 90%;
                    max-width: 520px;
                    max-height: 90vh;
                    background: #fff;
                    border-radius: 20px;
                    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4);
                    overflow: hidden;
                    animation: scaleIn 0.3s ease;
                    display: flex;
                    flex-direction: column;
                }
                
                @keyframes scaleIn {
                    from {
                        opacity: 0;
                        transform: scale(0.9);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1);
                    }
                }
                
                .ktkq-disclaimer-header {
                    padding: 24px;
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                    color: #fff;
                    text-align: center;
                }
                
                .ktkq-disclaimer-logo {
                    font-size: 48px;
                    margin-bottom: 12px;
                    animation: pulse 2s ease-in-out infinite;
                }
                
                .ktkq-disclaimer-header h3 {
                    font-size: 22px;
                    margin: 0 0 6px;
                    font-weight: 700;
                }
                
                .ktkq-disclaimer-header p {
                    font-size: 14px;
                    margin: 0;
                    opacity: 0.9;
                }
                
                .ktkq-disclaimer-body {
                    padding: 20px 24px;
                    overflow-y: auto;
                    flex: 1;
                }
                
                .ktkq-disclaimer-text h4 {
                    font-size: 15px;
                    color: #1e293b;
                    margin: 0 0 14px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .ktkq-disclaimer-text ol {
                    margin: 0;
                    padding-left: 20px;
                    color: #475569;
                    font-size: 13px;
                    line-height: 1.8;
                }
                
                .ktkq-disclaimer-text li {
                    margin-bottom: 10px;
                }
                
                .ktkq-disclaimer-text li strong {
                    color: #1e293b;
                }
                
                .ktkq-disclaimer-warning {
                    margin-top: 16px;
                    padding: 14px;
                    background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
                    border-radius: 12px;
                    border-left: 4px solid #ef4444;
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                }
                
                .ktkq-warning-icon {
                    font-size: 20px;
                }
                
                .ktkq-disclaimer-warning p {
                    margin: 0;
                    font-size: 13px;
                    color: #991b1b;
                    line-height: 1.5;
                }
                
                .ktkq-disclaimer-footer {
                    padding: 20px 24px;
                    background: #f8fafc;
                    border-top: 1px solid #e2e8f0;
                }
                
                .ktkq-disclaimer-checkbox {
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                    margin-bottom: 16px;
                    cursor: pointer;
                    font-size: 13px;
                    color: #475569;
                    line-height: 1.5;
                }
                
                .ktkq-disclaimer-checkbox input {
                    display: none;
                }
                
                .ktkq-disclaimer-checkbox .ktkq-checkbox-mark {
                    width: 20px;
                    height: 20px;
                    border: 2px solid #cbd5e0;
                    border-radius: 6px;
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s;
                    margin-top: 2px;
                }
                
                .ktkq-disclaimer-checkbox input:checked + .ktkq-checkbox-mark {
                    background: #3b82f6;
                    border-color: #3b82f6;
                }
                
                .ktkq-disclaimer-checkbox input:checked + .ktkq-checkbox-mark::after {
                    content: '✓';
                    color: #fff;
                    font-size: 12px;
                    font-weight: bold;
                }
                
                .ktkq-disclaimer-buttons {
                    display: flex;
                    gap: 12px;
                }
                
                .ktkq-disclaimer-buttons button {
                    flex: 1;
                    padding: 14px 20px;
                    border-radius: 12px;
                    font-size: 14px;
                    font-weight: 600;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                
                .ktkq-disclaimer-buttons .ktkq-btn-secondary {
                    background: #e2e8f0;
                    color: #475569;
                }
                
                .ktkq-disclaimer-buttons .ktkq-btn-secondary:hover {
                    background: #cbd5e0;
                }
                
                .ktkq-disclaimer-buttons .ktkq-btn-primary {
                    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    color: #fff;
                }
                
                .ktkq-disclaimer-buttons .ktkq-btn-primary:hover:not(:disabled) {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
                }
                
                .ktkq-disclaimer-buttons .ktkq-btn-primary:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                
                /* 夜间模式适配 - 免责声明弹窗 */
                [data-ktkq-night="true"] .ktkq-disclaimer-dialog {
                    background: #1f2937;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-text h4 {
                    color: #f9fafb;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-text ol {
                    color: #d1d5db;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-text li strong {
                    color: #f9fafb;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-warning {
                    background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
                    border-left-color: #dc2626;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-warning p {
                    color: #fca5a5;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-footer {
                    background: #111827;
                    border-top-color: #374151;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-checkbox {
                    color: #d1d5db;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-buttons .ktkq-btn-secondary {
                    background: #374151;
                    color: #d1d5db;
                }
                
                [data-ktkq-night="true"] .ktkq-disclaimer-buttons .ktkq-btn-secondary:hover {
                    background: #4b5563;
                }
                
                /* ========== 持久化警告样式 ========== */
                .ktkq-persistent-warning {
                    position: fixed;
                    top: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    z-index: 10006;
                    animation: slideDown 0.3s ease;
                }
                
                .ktkq-warning-content {
                    background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
                    border: 2px solid #fecaca;
                    border-radius: 16px;
                    padding: 20px 24px;
                    box-shadow: 0 10px 40px rgba(239, 68, 68, 0.3);
                    display: flex;
                    align-items: flex-start;
                    gap: 16px;
                    max-width: 500px;
                    position: relative;
                }
                
                .ktkq-warning-content .ktkq-warning-icon {
                    font-size: 32px;
                    flex-shrink: 0;
                    animation: pulse 2s ease-in-out infinite;
                }
                
                .ktkq-warning-text {
                    flex: 1;
                }
                
                .ktkq-warning-text h4 {
                    margin: 0 0 8px;
                    font-size: 16px;
                    font-weight: 700;
                    color: #991b1b;
                }
                
                .ktkq-warning-text p {
                    margin: 4px 0;
                    font-size: 13px;
                    color: #7f1d1d;
                    line-height: 1.6;
                }
                
                .ktkq-warning-close {
                    position: absolute;
                    top: 12px;
                    right: 12px;
                    width: 28px;
                    height: 28px;
                    border: none;
                    background: rgba(127, 29, 29, 0.1);
                    color: #991b1b;
                    font-size: 20px;
                    line-height: 1;
                    border-radius: 50%;
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .ktkq-warning-close:hover {
                    background: rgba(127, 29, 29, 0.2);
                    transform: scale(1.1);
                }
                
                /* 夜间模式适配 - 持久化警告 */
                [data-ktkq-night="true"] .ktkq-warning-content {
                    background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
                    border-color: #b91c1c;
                }
                
                [data-ktkq-night="true"] .ktkq-warning-text h4 {
                    color: #fecaca;
                }
                
                [data-ktkq-night="true"] .ktkq-warning-text p {
                    color: #fca5a5;
                }
                
                [data-ktkq-night="true"] .ktkq-warning-close {
                    background: rgba(254, 202, 202, 0.1);
                    color: #fecaca;
                }
                
                [data-ktkq-night="true"] .ktkq-warning-close:hover {
                    background: rgba(254, 202, 202, 0.2);
                }
                
                /* ========== 数据管理样式 ========== */
                .ktkq-data-management {
                    margin-top: 8px;
                }
                
                .ktkq-reset-btn {
                    width: 100%;
                    padding: 16px;
                    background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
                    border: 2px solid #fecaca;
                    border-radius: 12px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .ktkq-reset-btn:hover {
                    background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
                    border-color: #fca5a5;
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
                }
                
                .ktkq-reset-btn .ktkq-btn-icon {
                    font-size: 24px;
                    flex-shrink: 0;
                }
                
                .ktkq-reset-btn .ktkq-btn-content {
                    flex: 1;
                    text-align: left;
                }
                
                .ktkq-reset-btn .ktkq-btn-title {
                    display: block;
                    font-size: 14px;
                    font-weight: 600;
                    color: #991b1b;
                    margin-bottom: 4px;
                }
                
                .ktkq-reset-btn .ktkq-btn-desc {
                    display: block;
                    font-size: 12px;
                    color: #7f1d1d;
                    opacity: 0.8;
                }
                
                /* 恢复初始状态确认对话框 */
                .ktkq-reset-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 10005;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    animation: fadeIn 0.3s ease;
                }
                
                .ktkq-reset-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    backdrop-filter: blur(8px);
                }
                
                .ktkq-reset-dialog {
                    position: relative;
                    width: 90%;
                    max-width: 480px;
                    background: #fff;
                    border-radius: 20px;
                    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4);
                    overflow: hidden;
                    animation: scaleIn 0.3s ease;
                }
                
                .ktkq-reset-header {
                    padding: 24px;
                    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
                    color: #fff;
                    text-align: center;
                }
                
                .ktkq-reset-icon {
                    font-size: 48px;
                    margin-bottom: 12px;
                    animation: pulse 2s ease-in-out infinite;
                }
                
                .ktkq-reset-header h3 {
                    font-size: 20px;
                    margin: 0;
                    font-weight: 700;
                }
                
                .ktkq-reset-body {
                    padding: 24px;
                }
                
                .ktkq-reset-warning {
                    font-size: 14px;
                    color: #991b1b;
                    font-weight: 600;
                    margin: 0 0 16px;
                }
                
                .ktkq-reset-list {
                    margin: 0 0 16px;
                    padding-left: 20px;
                    list-style: none;
                }
                
                .ktkq-reset-list li {
                    font-size: 13px;
                    color: #475569;
                    margin-bottom: 8px;
                    padding-left: 8px;
                }
                
                .ktkq-reset-tip {
                    padding: 12px;
                    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
                    border-radius: 8px;
                    border-left: 4px solid #f59e0b;
                    font-size: 13px;
                    color: #78350f;
                    margin: 0;
                    line-height: 1.6;
                }
                
                .ktkq-reset-footer {
                    padding: 20px 24px;
                    background: #f8fafc;
                    border-top: 1px solid #e2e8f0;
                    display: flex;
                    gap: 12px;
                }
                
                .ktkq-reset-footer button {
                    flex: 1;
                    padding: 14px 20px;
                    border-radius: 12px;
                    font-size: 14px;
                    font-weight: 600;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                
                .ktkq-btn-danger {
                    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                    color: #fff;
                }
                
                .ktkq-btn-danger:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(239, 68, 68, 0.4);
                }
                
                /* 夜间模式适配 - 数据管理 */
                [data-ktkq-night="true"] .ktkq-reset-btn {
                    background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
                    border-color: #b91c1c;
                }
                
                [data-ktkq-night="true"] .ktkq-reset-btn:hover {
                    background: linear-gradient(135deg, #991b1b 0%, #b91c1c 100%);
                    border-color: #dc2626;
                }
                
                [data-ktkq-night="true"] .ktkq-reset-btn .ktkq-btn-title {
                    color: #fecaca;
                }
                
                [data-ktkq-night="true"] .ktkq-reset-btn .ktkq-btn-desc {
                    color: #fca5a5;
                }
                
                [data-ktkq-night="true"] .ktkq-reset-dialog {
                    background: #1f2937;
                }
                
                [data-ktkq-night="true"] .ktkq-reset-warning {
                    color: #fca5a5;
                }
                
                [data-ktkq-night="true"] .ktkq-reset-list li {
                    color: #d1d5db;
                }
                
                [data-ktkq-night="true"] .ktkq-reset-tip {
                    background: linear-gradient(135deg, #78350f 0%, #92400e 100%);
                    border-left-color: #f59e0b;
                    color: #fde68a;
                }
                
                [data-ktkq-night="true"] .ktkq-reset-footer {
                    background: #111827;
                    border-top-color: #374151;
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    // ==================== 启动 ====================
    console.log('[KTKQ] 脚本加载完成，准备启动');
    console.log('[KTKQ] 当前URL:', window.location.href);
    console.log('[KTKQ] document.readyState:', document.readyState);
    
    if (document.readyState === 'loading') {
        console.log('[KTKQ] 等待DOM加载完成');
        document.addEventListener('DOMContentLoaded', () => {
            console.log('[KTKQ] DOM加载完成，创建LocationAssistant实例');
            window.ktkqApp = new LocationAssistant();
        });
    } else {
        console.log('[KTKQ] DOM已就绪，立即创建LocationAssistant实例');
        window.ktkqApp = new LocationAssistant();
    }
})();
