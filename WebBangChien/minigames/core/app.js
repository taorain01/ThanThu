import { getEnabledGames, getGameByLegacyId, getRandomWheelEntries } from "./registry.js?v=20260625-9";
import { loadThreeJsDynamic } from "./three-loader.js";
import { createBeastWolfModel, getBeastSurfaceOffset, updateBeastIdlePose } from "./beast-model.js?v=20260625-1";
import { DERBY_SCENE_CONFIG } from "../games/speed-derby/config.js";

const loadThreeJSDynamic = loadThreeJsDynamic;
// ─── CẤU HÌNH SUPABASE ───

    const SUPABASE_URL = "https://wwrzjsgqmxwhjnqhphph.supabase.co";

    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3cnpqc2dxbXh3aGpucWhwaHBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzAxMjgsImV4cCI6MjA5MDUwNjEyOH0.F4BARXdexWqEWOplG6NigJK5Twti9VZY2VwTqhR4dK0";

    const GUILD_ID = "450633680000385036";

    let supabaseClient = null;



    let selectedGameLobbyId = 1; // Speed Derby




    (function initMinigameMusicPlayer() {

      const SVG_PLAY = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

      const SVG_PAUSE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

      const SVG_PLAY_MINI = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

      const SVG_PAUSE_MINI = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

      const MP_AUTOPLAY_KEY = 'minigame-mp-autoplay-enabled';

      const PLAYLISTS = [

        {

          name: 'Nhac cho game',

          folder: 'nhac/nhacmngchongame',

          tracks: [

            '1. Whispering Bloom Echoes',

            '4. Cloud Burst Giggle (1)',

            '6. Joyful Triumphant Bounce',

            '9. Aurora Stillness'

          ]

        },

        {

          name: 'Nhac dang choi',

          folder: 'nhac/nhacmngdangchoi',

          tracks: [

            '1. Apex Dominator Protocol',

            '2. Ironclad Ascension Protocol',

            '4. Celestial Apex Directive (1)',

            '4. Celestial Apex Directive',

            "6. Titan's Apex Sovereign Mandate (1)"

          ]

        }

      ];



      const $ = (id) => document.getElementById(id);

      const audio = $('mpAudio');

      if (!audio) return;



      let curPl = 0;

      let curIdx = -1;

      let shuffle = true;

      let repeat = false;

      let listOpen = false;

      let shufOrder = [];

      let autoplayEnabled = readAutoplayEnabled();

      let userVolume = 0.4;

      let fadeTimer = null;

      let trackLoadSeq = 0;

      const MUSIC_FADE_MS = 520;



      function readAutoplayEnabled() {

        try { return localStorage.getItem(MP_AUTOPLAY_KEY) !== '0'; }

        catch (_) { return true; }

      }



      function saveAutoplayEnabled(enabled) {

        autoplayEnabled = !!enabled;

        try { localStorage.setItem(MP_AUTOPLAY_KEY, autoplayEnabled ? '1' : '0'); }

        catch (_) {}

      }



      function buildShuf(len) {

        shufOrder = Array.from({ length: len }, (_, i) => i);

        for (let i = len - 1; i > 0; i--) {

          const j = Math.floor(Math.random() * (i + 1));

          [shufOrder[i], shufOrder[j]] = [shufOrder[j], shufOrder[i]];

        }

      }



      function displayName(name) {

        return String(name || '').replace(/^\d+\.\s*/, '');

      }



      function trackSrc(name) {

        return './' + PLAYLISTS[curPl].folder + '/' + encodeURIComponent(name + '.mp3').replace(/%2F/g, '/');

      }



      function syncAutoplayUI() {

        const checkbox = $('mpAutoplay');

        const mini = $('mpMiniAutoplay');

        if (checkbox) checkbox.checked = autoplayEnabled;

        if (mini) {

          mini.classList.toggle('on', autoplayEnabled);

          mini.setAttribute('aria-pressed', autoplayEnabled ? 'true' : 'false');

        }

      }



      function syncPlayerUI(playing) {

        const playBtn = $('mpPlayBtn');

        const miniBtn = $('mpMiniPlay');

        const disc = $('mpDisc');

        if (playBtn) playBtn.innerHTML = playing ? SVG_PAUSE : SVG_PLAY;

        if (miniBtn) {

          miniBtn.innerHTML = playing ? SVG_PAUSE_MINI : SVG_PLAY_MINI;

          miniBtn.classList.toggle('playing', playing);

        }

        if (disc) disc.classList.toggle('spin', playing);

        document.querySelectorAll('.mp-eq-bar').forEach((bar) => bar.classList.toggle('on', playing));

      }



      function setVolume(v) {

        const value = Math.max(0, Math.min(100, Number(v) || 0));

        userVolume = value / 100;

        audio.volume = userVolume;

        const slider = $('mpVolSl');

        if (slider) slider.style.setProperty('--vp', value + '%');

        const label = $('mpVolLbl');

        if (label) label.textContent = value < 10 ? '🔇' : value < 50 ? '🔉' : '🔊';

      }



      function fadeTo(targetVolume, durationMs, done) {

        clearInterval(fadeTimer);

        const from = Number.isFinite(audio.volume) ? audio.volume : userVolume;

        const target = Math.max(0, Math.min(userVolume, targetVolume));

        const startedAt = performance.now();

        if (durationMs <= 0 || Math.abs(from - target) < 0.01) {

          audio.volume = target;

          if (done) done();

          return;

        }

        fadeTimer = setInterval(() => {

          const progress = Math.min(1, (performance.now() - startedAt) / durationMs);

          audio.volume = from + (target - from) * progress;

          if (progress >= 1) {

            clearInterval(fadeTimer);

            fadeTimer = null;

            audio.volume = target;

            if (done) done();

          }

        }, 24);

      }



      function renderList() {

        const list = $('mpList');

        const count = $('mpListCnt');

        const pl = PLAYLISTS[curPl];

        if (!list || !count) return;

        list.innerHTML = '';

        count.textContent = pl.tracks.length;

        if (!pl.tracks.length) {

          const empty = document.createElement('div');

          empty.className = 'mp-li';

          empty.innerHTML = '<span class="mp-li-name">Chua co file mp3 trong folder nay</span>';

          list.appendChild(empty);

          return;

        }

        pl.tracks.forEach((track, idx) => {

          const item = document.createElement('div');

          item.className = 'mp-li' + (idx === curIdx ? ' active' : '');

          item.innerHTML = '<span class="mp-li-num">' + (idx + 1) + '</span><span class="mp-li-name">' + displayName(track) + '</span>';

          item.onclick = () => loadTrack(curPl, idx, true);

          list.appendChild(item);

        });

      }



      function loadTrack(plIdx, trackIdx, shouldPlay) {

        const seq = ++trackLoadSeq;

        const pl = PLAYLISTS[plIdx];

        if (!pl || !pl.tracks.length) {

          clearInterval(fadeTimer);

          fadeTimer = null;

          curPl = plIdx;

          curIdx = -1;

          audio.pause();

          audio.removeAttribute('src');

          if ($('mpTname')) $('mpTname').textContent = 'Chua co nhac';

          if ($('mpTpl')) $('mpTpl').textContent = pl ? pl.name : '';

          if ($('mpTidx')) $('mpTidx').textContent = '';

          if ($('mpMiniTrack')) $('mpMiniTrack').textContent = '♪ Chua co nhac';

          document.querySelectorAll('.mp-tab').forEach((tab, idx) => tab.classList.toggle('active', idx === curPl));

          renderList();

          syncPlayerUI(false);

          return;

        }



        const applyTrack = () => {

          if (seq !== trackLoadSeq) return;

          curPl = plIdx;

          curIdx = Math.max(0, Math.min(trackIdx, pl.tracks.length - 1));

          const track = pl.tracks[curIdx];

          audio.src = trackSrc(track);

          audio.volume = shouldPlay ? 0 : userVolume;

          if ($('mpTname')) $('mpTname').textContent = displayName(track);

          if ($('mpTpl')) $('mpTpl').textContent = pl.name;

          if ($('mpTidx')) $('mpTidx').textContent = 'Bai ' + (curIdx + 1) + ' / ' + pl.tracks.length;

          if ($('mpMiniTrack')) $('mpMiniTrack').textContent = '♪ ' + displayName(track);

          document.querySelectorAll('.mp-tab').forEach((tab, idx) => tab.classList.toggle('active', idx === curPl));

          renderList();

          if (shouldPlay) {

            audio.play()

              .then(() => {

                if (seq !== trackLoadSeq) return;

                syncPlayerUI(true);

                fadeTo(userVolume, MUSIC_FADE_MS);

              })

              .catch(() => syncPlayerUI(false));

          } else {

            syncPlayerUI(false);

          }

        };



        if (shouldPlay && !audio.paused && !audio.ended && audio.src) {

          fadeTo(0, MUSIC_FADE_MS, applyTrack);

        } else {

          clearInterval(fadeTimer);

          fadeTimer = null;

          applyTrack();

        }

      }



      function switchPlaylist(idx, keepPlayback) {

        if (!PLAYLISTS[idx] || idx === curPl) return;

        const wasPlaying = !audio.paused && !audio.ended;

        buildShuf(PLAYLISTS[idx].tracks.length);

        loadTrack(idx, shuffle && shufOrder.length ? shufOrder[0] : 0, keepPlayback && wasPlaying);

      }



      function nextIndex() {

        const len = PLAYLISTS[curPl].tracks.length;

        if (!len) return -1;

        if (!shuffle) return (curIdx + 1 + len) % len;

        if (shufOrder.length !== len) buildShuf(len);

        const pos = Math.max(0, shufOrder.indexOf(curIdx));

        const nextPos = (pos + 1) % len;

        if (nextPos === 0) buildShuf(len);

        return shufOrder[nextPos];

      }



      function prevIndex() {

        const len = PLAYLISTS[curPl].tracks.length;

        if (!len) return -1;

        if (!shuffle) return (curIdx - 1 + len) % len;

        if (shufOrder.length !== len) buildShuf(len);

        const pos = Math.max(0, shufOrder.indexOf(curIdx));

        return shufOrder[(pos - 1 + len) % len];

      }



      function fmtTime(seconds) {

        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';

        return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');

      }



      window.mpSwitchPl = (idx) => switchPlaylist(idx, true);

      window.mpTogglePlay = function() {

        if (!PLAYLISTS[curPl].tracks.length) return;

        if (curIdx < 0) {

          buildShuf(PLAYLISTS[curPl].tracks.length);

          loadTrack(curPl, shuffle && shufOrder.length ? shufOrder[0] : 0, true);

          return;

        }

        if (audio.paused) {

          audio.volume = 0;

          audio.play()

            .then(() => {

              syncPlayerUI(true);

              fadeTo(userVolume, MUSIC_FADE_MS);

            })

            .catch(() => syncPlayerUI(false));

        }

        else {

          fadeTo(0, MUSIC_FADE_MS, () => {

            audio.pause();

            audio.volume = userVolume;

            syncPlayerUI(false);

          });

        }

      };

      window.mpToggleCollapse = function() {

        const wrap = $('mpWrap');

        if (!wrap) return;

        wrap.classList.toggle('collapsed');

        if ($('mpCollapseBtn')) $('mpCollapseBtn').setAttribute('aria-expanded', wrap.classList.contains('collapsed') ? 'false' : 'true');

        if (wrap.classList.contains('collapsed') && $('mpList')) {

          listOpen = false;

          $('mpList').classList.remove('open');

        }

      };

      window.mpClosePlayer = function() {

        fadeTo(0, MUSIC_FADE_MS, () => {

          audio.pause();

          audio.volume = userVolume;

          syncPlayerUI(false);

          if ($('mpWrap')) $('mpWrap').classList.add('mp-closed');

        });

      };

      window.mpNext = function() {

        const idx = nextIndex();

        if (idx >= 0) loadTrack(curPl, idx, !audio.paused || audio.ended);

      };

      window.mpPrev = function() {

        if (audio.currentTime > 3) {

          audio.currentTime = 0;

          return;

        }

        const idx = prevIndex();

        if (idx >= 0) loadTrack(curPl, idx, !audio.paused);

      };

      window.mpToggleShuf = function() {

        shuffle = !shuffle;

        if ($('mpShuf')) $('mpShuf').classList.toggle('on', shuffle);

        buildShuf(PLAYLISTS[curPl].tracks.length);

      };

      window.mpToggleRep = function() {

        repeat = !repeat;

        audio.loop = repeat;

        if ($('mpRep')) $('mpRep').classList.toggle('on', repeat);

      };

      window.mpSetVol = setVolume;

      window.mpToggleList = function() {

        listOpen = !listOpen;

        if ($('mpList')) $('mpList').classList.toggle('open', listOpen);

        if ($('mpListArrow')) $('mpListArrow').textContent = listOpen ? '▲' : '▼';

      };

      window.mpSetAutoplay = function(enabled) {

        saveAutoplayEnabled(enabled);

        syncAutoplayUI();

        if (autoplayEnabled && audio.paused) {

          autoEvents.forEach((eventName) => document.addEventListener(eventName, tryAutoplayFromGesture, true));

        } else {

          removeAutoListeners();

        }

      };

      window.mpToggleAutoplayMini = function(event) {

        if (event) event.stopPropagation();

        window.mpSetAutoplay(!autoplayEnabled);

      };

      window.mngMusicSetMode = function(mode) {

        switchPlaylist(mode === 'playing' ? 1 : 0, true);

      };



      audio.addEventListener('play', () => syncPlayerUI(true));

      audio.addEventListener('pause', () => syncPlayerUI(false));

      audio.addEventListener('ended', () => { if (!repeat) window.mpNext(); });

      audio.addEventListener('timeupdate', () => {

        if (!audio.duration) return;

        if ($('mpProgFill')) $('mpProgFill').style.width = (audio.currentTime / audio.duration * 100) + '%';

        if ($('mpTcur')) $('mpTcur').textContent = fmtTime(audio.currentTime);

        if ($('mpTtot')) $('mpTtot').textContent = fmtTime(audio.duration);

      });

      audio.addEventListener('loadedmetadata', () => {

        if ($('mpTtot')) $('mpTtot').textContent = fmtTime(audio.duration);

      });

      if ($('mpProgTrack')) {

        $('mpProgTrack').addEventListener('click', (event) => {

          if (!audio.duration) return;

          const rect = $('mpProgTrack').getBoundingClientRect();

          audio.currentTime = ((event.clientX - rect.left) / rect.width) * audio.duration;

        });

      }



      const eq = $('mpEq');

      if (eq) {

        [12, 18, 14, 22, 16, 20, 10, 17, 23, 15, 19, 13, 21, 11].forEach((height, idx) => {

          const bar = document.createElement('div');

          bar.className = 'mp-eq-bar';

          bar.style.setProperty('--h', height + 'px');

          bar.style.setProperty('--d', (0.42 + (idx % 5) * 0.06) + 's');

          bar.style.animationDelay = (idx * 0.04) + 's';

          eq.appendChild(bar);

        });

      }



      document.addEventListener('visibilitychange', () => {

        if (document.hidden) syncPlayerUI(!audio.paused && !audio.ended);

      });



      let autoStarted = false;

      const autoEvents = ['click', 'keydown', 'touchstart', 'pointerdown'];

      function removeAutoListeners() {

        autoEvents.forEach((eventName) => document.removeEventListener(eventName, tryAutoplayFromGesture, true));

      }

      function tryAutoplayFromGesture() {

        if (autoStarted || !autoplayEnabled || document.hidden || !audio.paused) {

          if (!autoplayEnabled || !audio.paused) removeAutoListeners();

          return;

        }

        autoStarted = true;

        audio.volume = 0;

        audio.play()

          .then(() => {

            syncPlayerUI(true);

            fadeTo(userVolume, MUSIC_FADE_MS);

            removeAutoListeners();

          })

          .catch(() => {

            autoStarted = false;

          });

      }

      autoEvents.forEach((eventName) => document.addEventListener(eventName, tryAutoplayFromGesture, true));



      buildShuf(PLAYLISTS[0].tracks.length);

      loadTrack(0, shuffle && shufOrder.length ? shufOrder[0] : 0, false);

      if ($('mpShuf')) $('mpShuf').classList.add('on');

      setVolume($('mpVolSl') ? $('mpVolSl').value : 40);

      syncAutoplayUI();

    })();



    try {

      if (typeof supabase !== 'undefined' && supabase.createClient) {

        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      }

    } catch(e) {

      console.warn("Lỗi khởi tạo Supabase:", e);

    }



    // ─── ĐỊNH NGHĨA LINH THÚ ───

    const MYTHICAL_BEAST_SKINS = [

      { name: "Thanh Long", color: "#10b981", element: "Mộc", emoji: "🐉" },

      { name: "Bạch Hổ", color: "#e2e8f0", element: "Kim", emoji: "🐅" },

      { name: "Chu Tước", color: "#ef4444", element: "Hỏa", emoji: "🦚" },

      { name: "Huyền Vũ", color: "#3b82f6", element: "Thủy", emoji: "🐢" },

      { name: "Kỳ Lân", color: "#fbbf24", element: "Thổ", emoji: "🦄" },

      { name: "Thiên Lang", color: "#a855f7", element: "Lôi", emoji: "🐺" },

      { name: "Kim Ô", color: "#f97316", element: "Quang", emoji: "🦅" },

      { name: "Tỳ Hưu", color: "#f43f5e", element: "Tài", emoji: "🦁" }

    ];



    // ─── HỆ THỐNG ÂM THANH KỸ THUẬT SỐ (WEB AUDIO SYNTHESIZER) ───

    let audioCtx = null;

    let audioMuted = false;

    let audioPageActive = !document.hidden;

    let lightningNoiseBuffer = null;

    const activeAudioNodes = new Set();

    const GAME_SFX_VOLUME_SCALE = 0.4; // Giảm 60% âm lượng hiệu ứng game.

    function scaleGameSfxVolume(volume) {

      return Math.max(0.0001, volume * GAME_SFX_VOLUME_SCALE);

    }

    const audioCooldowns = {

      tick: 0,

      horn: 0,

      lightning: 0,

      victory: 0,

      boost: 0

    };



    function initAudioContext() {

      if (!audioCtx) {

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      }

      if (audioPageActive && audioCtx.state === 'suspended') {

        audioCtx.resume();

      }

    }



    function canPlayGameAudio() {

      return !audioMuted && audioPageActive && !document.hidden && document.hasFocus();

    }



    function canPlayAudioType(type, cooldownMs) {

      if (!canPlayGameAudio()) return false;

      const now = performance.now();

      if (now - (audioCooldowns[type] || 0) < cooldownMs) return false;

      audioCooldowns[type] = now;

      return true;
    }



    function trackAudioNode(node) {

      if (!node) return node;

      activeAudioNodes.add(node);

      node.onended = () => activeAudioNodes.delete(node);

      return node;

    }



    function getLightningNoiseBuffer() {

      if (!audioCtx) return null;

      if (lightningNoiseBuffer && lightningNoiseBuffer.sampleRate === audioCtx.sampleRate) {

        return lightningNoiseBuffer;

      }



      const bufferSize = Math.floor(audioCtx.sampleRate * 1.5);

      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);

      const data = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {

        data[i] = Math.random() * 2 - 1;

      }

      lightningNoiseBuffer = buffer;

      return lightningNoiseBuffer;

    }



    function stopActiveGameAudio() {

      activeAudioNodes.forEach((node) => {

        try { node.stop(0); } catch(e) {}

      });

      activeAudioNodes.clear();

      if (audioCtx && audioCtx.state === 'running') {

        audioCtx.suspend().catch(() => {});

      }

    }



    function handleAudioVisibilityChange() {

      audioPageActive = !document.hidden && document.hasFocus();

      if (!audioPageActive) {

        stopActiveGameAudio();

        Object.keys(audioCooldowns).forEach((key) => { audioCooldowns[key] = performance.now(); });

      }

    }



    document.addEventListener('visibilitychange', handleAudioVisibilityChange);

    window.addEventListener('blur', handleAudioVisibilityChange);

    window.addEventListener('focus', () => {

      audioPageActive = !document.hidden;

    });



    function toggleAudioMuted() {

      audioMuted = !audioMuted;

      document.getElementById('sound-toggle-btn').textContent = audioMuted ? '🔇' : '🔊';

      if (audioMuted) stopActiveGameAudio();

    }



    // Phát âm thanh bíp cơ học (Vòng quay tick)

    function playTickSound(frequency = 600, duration = 0.04) {

      if (!canPlayAudioType('tick', 45)) return;

      try {

        initAudioContext();

        const osc = trackAudioNode(audioCtx.createOscillator());

        const gain = audioCtx.createGain();

        osc.connect(gain);

        gain.connect(audioCtx.destination);



        osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + duration);



        gain.gain.setValueAtTime(scaleGameSfxVolume(0.12), audioCtx.currentTime);

        gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + duration);



        osc.type = 'triangle';

        osc.start();

        osc.stop(audioCtx.currentTime + duration);

      } catch (err) {

        console.warn("Không phát được âm thanh Synthesizer:", err);

      }

    }



    // Phát nhạc còi xuất phát (Race horn)

    function playHornSound() {

      if (!canPlayAudioType('horn', 600)) return;

      try {

        initAudioContext();

        const t = audioCtx.currentTime;

        [220, 277, 330].forEach((freq, idx) => {

          const osc = trackAudioNode(audioCtx.createOscillator());

          const gain = audioCtx.createGain();

          osc.connect(gain);

          gain.connect(audioCtx.destination);

          

          osc.frequency.setValueAtTime(freq, t);

          gain.gain.setValueAtTime(0, t);

          gain.gain.linearRampToValueAtTime(scaleGameSfxVolume(0.08), t + 0.05);

          gain.gain.setValueAtTime(scaleGameSfxVolume(0.08), t + 0.3);

          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

          

          osc.type = 'sawtooth';

          osc.start(t);

          osc.stop(t + 0.5);

        });

      } catch(e){}

    }



    // Phát tiếng sét đánh

    function playLightningSound() {

      if (!canPlayAudioType('lightning', 900)) return;

      try {

        initAudioContext();

        const buffer = getLightningNoiseBuffer();

        if (!buffer) return;



        const noiseNode = trackAudioNode(audioCtx.createBufferSource());

        noiseNode.buffer = buffer;



        // Bộ lọc tần số thấp

        const filter = audioCtx.createBiquadFilter();

        filter.type = 'lowpass';

        filter.frequency.setValueAtTime(180, audioCtx.currentTime);

        filter.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 1.2);



        const gainNode = audioCtx.createGain();

        gainNode.gain.setValueAtTime(scaleGameSfxVolume(0.25), audioCtx.currentTime);

        gainNode.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 1.4);



        noiseNode.connect(filter);

        filter.connect(gainNode);

        gainNode.connect(audioCtx.destination);



        noiseNode.start();

        noiseNode.stop(audioCtx.currentTime + 1.5);

        

        // Âm bass nổ bổ sung

        const osc = trackAudioNode(audioCtx.createOscillator());

        const oscGain = audioCtx.createGain();

        osc.connect(oscGain);

        oscGain.connect(audioCtx.destination);

        osc.frequency.setValueAtTime(80, audioCtx.currentTime);

        osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.3);

        oscGain.gain.setValueAtTime(scaleGameSfxVolume(0.3), audioCtx.currentTime);

        oscGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

        osc.type = 'sine';

        osc.start();

        osc.stop(audioCtx.currentTime + 0.4);

      } catch(e){}

    }



    // Nhạc chiến thắng (Victory Fanfare)

    function playVictorySound() {

      if (!canPlayAudioType('victory', 2000)) return;

      try {

        initAudioContext();

        const t = audioCtx.currentTime;

        const notes = [

          { f: 523.25, start: 0, dur: 0.15 }, // C5

          { f: 523.25, start: 0.15, dur: 0.15 }, 

          { f: 523.25, start: 0.3, dur: 0.15 }, 

          { f: 523.25, start: 0.45, dur: 0.4 }, 

          { f: 415.30, start: 0.85, dur: 0.4 }, // Ab4

          { f: 466.16, start: 1.25, dur: 0.4 }, // Bb4

          { f: 523.25, start: 1.65, dur: 0.8 }  // C5

        ];

        

        notes.forEach(note => {

          const osc = trackAudioNode(audioCtx.createOscillator());

          const gain = audioCtx.createGain();

          osc.connect(gain);

          gain.connect(audioCtx.destination);

          

          osc.frequency.setValueAtTime(note.f, t + note.start);

          gain.gain.setValueAtTime(0, t + note.start);

          gain.gain.linearRampToValueAtTime(scaleGameSfxVolume(0.15), t + note.start + 0.05);

          gain.gain.setValueAtTime(scaleGameSfxVolume(0.15), t + note.start + note.dur - 0.05);

          gain.gain.exponentialRampToValueAtTime(0.001, t + note.start + note.dur);

          

          osc.type = 'sawtooth';

          osc.start(t + note.start);

          osc.stop(t + note.start + note.dur);

        });

      } catch(e){}

    }



    // Tiếng chuông nhặt ngọc tăng tốc

    function playBoostSound() {

      if (!canPlayAudioType('boost', 220)) return;

      try {

        initAudioContext();

        const osc = trackAudioNode(audioCtx.createOscillator());

        const gain = audioCtx.createGain();

        osc.connect(gain);

        gain.connect(audioCtx.destination);

        osc.frequency.setValueAtTime(880, audioCtx.currentTime);

        osc.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.2);

        gain.gain.setValueAtTime(scaleGameSfxVolume(0.08), audioCtx.currentTime);

        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);

        osc.type = 'sine';

        osc.start();

        osc.stop(audioCtx.currentTime + 0.2);

      } catch(e){}

    }





    // ─── ĐỒ HỌA VÀ ĐIỀU KHIỂN SẢNH CHỜ (LOBBY UI) ───

    const DEFAULT_PRIZES = ["Giải Nhất", "Giải Nhì", "Giải Ba", "Khuyến Khích 1", "Khuyến Khích 2"];

    const MAX_RACERS = 40;

    // DERBY_SCENE_CONFIG được import từ ../games/speed-derby/config.js


    const DEFAULT_DERBY_LANE_SPACING = 1.5;
    const DERBY_SKY_TEXTURE_URL = DERBY_SCENE_CONFIG.backgrounds?.sky || "anh/bg_derby_sky.png";
    const DERBY_CAMERA_LOOK_Y = DERBY_SCENE_CONFIG.camera?.lookY ?? 4.2;
    const DERBY_CAMERA_MIN_Y = DERBY_SCENE_CONFIG.camera?.minY ?? 9;
    const DERBY_VISIBLE_LABEL_TOP_LIMIT = 10;
    const DERBY_LABEL_START_DELAY_MS = 1600;
    const DERBY_LABEL_COMPACT_AFTER_RANK = 4;
    const DERBY_FINISH_LABEL_VISIBLE_MS = 3600;
    const DERBY_CAMERA_RACER_Y_REFERENCE = 4;
    const DERBY_ROAD_BASE_WIDTH = 9.5;
    const DERBY_ROAD_BACK_DEPTH = 160;
    const DERBY_ROAD_WIDTH_DEPTH_FACTOR = 32;



    function getDerbyLaneSpacing(numRacers) {

      return Math.max(0.8, Math.min(DEFAULT_DERBY_LANE_SPACING, 46 / Math.max(numRacers, 1)));

    }



    function getDerbyTrackWidth(numRacers) {

      return numRacers * getDerbyLaneSpacing(numRacers) + 2;

    }

    function getDerbyConfiguredDurationSeconds(fallback = 60) {
      const preview = DERBY_SCENE_CONFIG.preview || {};
      return Math.max(5, derbyNumber(preview.duration, fallback));
    }

    function getDerbySelectedDurationSeconds() {
      return parseInt(document.getElementById("race-duration-select")?.value, 10) || getDerbyConfiguredDurationSeconds();
    }

    function syncDerbyDurationControlFromConfig() {
      const duration = getDerbyConfiguredDurationSeconds();
      const input = document.getElementById("race-duration-select");
      const label = document.getElementById("duration-val");
      if (input) input.value = String(duration);
      if (label) label.textContent = `${duration} giây`;
      syncDurationControlForSelectedGame();
    }

    function derbyNumber(value, fallback) {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    }

    function derbyBool(value, fallback = true) {
      return typeof value === "boolean" ? value : fallback;
    }

    function derbyDegToRad(value) {
      return derbyNumber(value, 0) * Math.PI / 180;
    }

    function getDerbyCameraConfig() {
      return DERBY_SCENE_CONFIG.camera || {};
    }

    function getDerbyRoadConfig() {
      return DERBY_SCENE_CONFIG.road || {};
    }

    function getDerbyBackgroundConfig() {
      return DERBY_SCENE_CONFIG.backgrounds || {};
    }

    function normalizeDerbyMode(value) {
      return String(value || "").replace(/[-_\s]/g, "").toLowerCase();
    }

    function isDerbyCameraLayerMode(bg = getDerbyBackgroundConfig()) {
      return normalizeDerbyMode(bg.racetrackMode) === "cameralayer";
    }

    function applyDerbySceneStyles() {
      const container = document.getElementById("webgl-container");
      if (!container) return;

      const bg = getDerbyBackgroundConfig();
      const skyUrl = bg.sky || DERBY_SKY_TEXTURE_URL;
      const skyOpacity = Math.max(0, Math.min(1, derbyNumber(bg.skyOpacity, 1)));
      const shadeOpacity = Math.max(0, Math.min(0.88, 1 - skyOpacity));
      const skyX = derbyNumber(bg.skyPositionX, 50);
      const skyY = derbyNumber(bg.skyPositionY, 50);
      const skySize = getDerbySkyBackgroundSize(container, bg);
      container.style.background = [
        `linear-gradient(180deg, rgba(1, 6, 4, ${0.16 + shadeOpacity}) 0%, rgba(1, 6, 4, ${0.02 + shadeOpacity * 0.35}) 42%, rgba(0, 0, 0, ${0.58 + shadeOpacity * 0.3}) 100%)`,
        `url("${skyUrl}") ${skyX}% ${skyY}% / ${skySize} no-repeat`,
        "#020705"
      ].join(", ");
      container.style.setProperty("--derby-glow-opacity", String(derbyNumber(bg.glowOpacity, 0.82)));
      container.style.setProperty("--derby-vignette-opacity", String(derbyNumber(bg.vignetteOpacity, 0.76)));
      container.style.filter = `brightness(${derbyNumber(bg.skyBrightness, 1)}) saturate(${derbyNumber(bg.skySaturation, 1)})`;
      updateDerbyCameraLayer(derbyCameraFocusZ ?? trackLength);
    }

    function getDerbySkyBackgroundSize(container, bg) {
      const legacyStretch = bg.skySizeX != null || bg.skySizeY != null;
      const mode = bg.skyFitMode || (legacyStretch ? "stretch" : "cover");
      if (mode === "stretch") {
        const skySizeX = Math.max(10, derbyNumber(bg.skySizeX, 100));
        const skySizeY = Math.max(10, derbyNumber(bg.skySizeY, 100));
        return `${skySizeX}% ${skySizeY}%`;
      }
      const width = Math.max(1, container?.clientWidth || 1);
      const height = Math.max(1, container?.clientHeight || 1);
      const aspect = Math.max(0.1, derbyNumber(bg.skyAspect, 1));
      const scale = Math.max(0.01, derbyNumber(bg.skyScale, 100) / 100);
      let targetW;
      let targetH;
      if (mode === "height") {
        targetH = height * scale;
        targetW = targetH * aspect;
      } else if (mode === "width") {
        targetW = width * scale;
        targetH = targetW / aspect;
      } else if (mode === "contain") {
        if (width / height > aspect) {
          targetH = height * scale;
          targetW = targetH * aspect;
        } else {
          targetW = width * scale;
          targetH = targetW / aspect;
        }
      } else {
        if (width / height > aspect) {
          targetW = width * scale;
          targetH = targetW / aspect;
        } else {
          targetH = height * scale;
          targetW = targetH * aspect;
        }
      }
      return `${Math.round(targetW)}px ${Math.round(targetH)}px`;
    }

    function getDerbyRaceProgressFromFocusZ(focusZ) {
      const runDistance = Math.max(1, trackLength - 10);
      return Math.max(0, Math.min(1, (trackLength - derbyNumber(focusZ, trackLength)) / runDistance));
    }

    function getDerbyCameraZOffset() {
      const numRacers = threeRacers.length;
      const cameraCfg = getDerbyCameraConfig();
      return Math.max(
        derbyNumber(cameraCfg.zOffsetBase, 24),
        derbyTrackWidth * derbyNumber(cameraCfg.zWidthFactor, 0.9)
      );
    }

    function getDerbyRoadBounds() {
      const cameraOffset = getDerbyCameraZOffset();
      const extraWidth = Math.max(0, derbyTrackWidth - DERBY_ROAD_BASE_WIDTH);
      const backDepth = DERBY_ROAD_BACK_DEPTH + extraWidth * DERBY_ROAD_WIDTH_DEPTH_FACTOR;
      return {
        roadMinZ: 10 - backDepth,
        roadMaxZ: trackLength + Math.max(320, cameraOffset * 2.25, derbyTrackWidth * 6)
      };
    }

    function ensureDerbyCameraLayer() {
      if (derbyCameraLayer && derbyCameraLayer.isConnected) return derbyCameraLayer;
      derbyCameraLayer = document.getElementById("derby-camera-layer");
      const container = document.getElementById("webgl-container");
      if (!derbyCameraLayer && container) {
        derbyCameraLayer = document.createElement("div");
        derbyCameraLayer.id = "derby-camera-layer";
        derbyCameraLayer.className = "derby-camera-layer";
        derbyCameraLayer.setAttribute("aria-hidden", "true");
        container.insertBefore(derbyCameraLayer, container.firstChild);
      }
      return derbyCameraLayer;
    }

    function updateDerbyCameraLayer(focusZ = trackLength) {
      const bg = getDerbyBackgroundConfig();
      const layer = ensureDerbyCameraLayer();
      if (!layer) return;

      if (!isDerbyCameraLayerMode(bg) || !bg.racetrack) {
        layer.style.display = "none";
        return;
      }

      const progress = getDerbyRaceProgressFromFocusZ(focusZ);
      const lateProgress = Math.max(0, Math.min(1, (progress - 0.72) / 0.28));
      const scale = 1 + lateProgress * 0.045;
      const translateY = -lateProgress * 2.4;
      const translateX = (derbyNumber(bg.racetrackOffsetX, 0) - 0.5) * 2;
      const blendMode = bg.racetrackBlending === "normal" ? "normal" : "screen";

      layer.style.display = "block";
      layer.style.backgroundImage = `url("${bg.racetrack}")`;
      layer.style.backgroundSize = "cover";
      layer.style.backgroundPosition = "center center";
      layer.style.opacity = String(Math.max(0, Math.min(1, derbyNumber(bg.racetrackOpacity, 0.66))));
      layer.style.mixBlendMode = blendMode;
      layer.style.filter = `brightness(${derbyNumber(bg.racetrackBrightness, 1)})`;
      layer.style.transform = `translate3d(${translateX}%, ${translateY}%, 0) scale(${scale})`;
    }

    function resetDerbyCameraLayer() {
      const layer = ensureDerbyCameraLayer();
      if (!layer) return;
      layer.style.display = "none";
      layer.style.transform = "";
      layer.style.backgroundImage = "";
    }

    function applyDerbyTransform(object, transform = {}) {
      if (!object) return;
      object.position.set(
        derbyNumber(transform.x, 0),
        derbyNumber(transform.y, 0),
        derbyNumber(transform.z, 0)
      );
      object.rotation.set(
        derbyDegToRad(transform.rx),
        derbyDegToRad(transform.ry),
        derbyDegToRad(transform.rz)
      );
      const sx = derbyNumber(transform.sx, derbyNumber(transform.scale, 1));
      const sy = derbyNumber(transform.sy, derbyNumber(transform.scale, 1));
      const sz = derbyNumber(transform.sz, derbyNumber(transform.scale, 1));
      object.scale.set(sx, sy, sz);
    }



    function normalizeRacerName(value) {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("vi-VN")
        .replace(/đ/g, "d")
        .replace(/\s+/g, " ")
        .trim();
    }

    function getRacerNamesFromInput() {
      const namesInput = document.getElementById("names-input");
      if (!namesInput) return [];
      return namesInput.value
        .split("\n")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
    }

    function syncRacerCheckState() {
      const input = document.getElementById("racer-check-input");
      const status = document.getElementById("racer-check-status");
      const addBtn = document.getElementById("btn-add-checked-racer");
      if (!input || !status || !addBtn) return;

      const rawName = input.value.trim();
      const normalizedName = normalizeRacerName(rawName);
      const names = getRacerNamesFromInput();
      status.className = "racer-check-status";
      addBtn.style.display = "none";
      addBtn.disabled = true;

      if (!normalizedName) {
        status.textContent = "";
        return;
      }

      const exists = names.some((name) => normalizeRacerName(name) === normalizedName);
      if (exists) {
        status.textContent = "Đã có trong danh sách đua.";
        status.classList.add("exists");
        return;
      }

      if (names.length >= MAX_RACERS) {
        status.textContent = `Danh sách đã đủ ${MAX_RACERS} người, không thể thêm nữa.`;
        status.classList.add("full");
        return;
      }

      status.textContent = "Chưa có trong danh sách đua.";
      status.classList.add("missing");
      addBtn.style.display = "inline-flex";
      addBtn.disabled = false;
    }

    function addCheckedRacerToList() {
      const input = document.getElementById("racer-check-input");
      const namesInput = document.getElementById("names-input");
      if (!input || !namesInput) return;

      const rawName = input.value.trim();
      const normalizedName = normalizeRacerName(rawName);
      if (!normalizedName) {
        syncRacerCheckState();
        return;
      }

      const names = getRacerNamesFromInput();
      const exists = names.some((name) => normalizeRacerName(name) === normalizedName);
      if (exists || names.length >= MAX_RACERS) {
        syncRacerCheckState();
        return;
      }

      namesInput.value = [...names, rawName].join("\n");
      updateNamesCount();
      syncRacerCheckState();
    }

    function getDuplicatedRacerNames(names) {
      const seenNames = new Set();
      const duplicatedKeys = new Set();
      const duplicatedNames = [];

      names.forEach((name) => {
        const normalizedName = normalizeRacerName(name);
        if (seenNames.has(normalizedName)) duplicatedKeys.add(normalizedName);
        seenNames.add(normalizedName);
      });

      names.forEach((name) => {
        const normalizedName = normalizeRacerName(name);
        const alreadyListed = duplicatedNames.some((listedName) => normalizeRacerName(listedName) === normalizedName);
        if (duplicatedKeys.has(normalizedName) && !alreadyListed) {
          duplicatedNames.push(name);
        }
      });

      return duplicatedNames;
    }

    function validateRacerNames(names) {
      if (names.length === 0) {
        alert("Vui lòng nhập ít nhất tên của 1 đấu sĩ!");
        return false;
      }

      if (names.length > MAX_RACERS) {
        alert(`Số lượng người tham gia tối đa là ${MAX_RACERS} người để tránh quá tải!`);
        return false;
      }
      return true;
    }

    function updateNamesCount() {
      const names = getRacerNamesFromInput();
      const count = names.length;
      const indicator = document.getElementById("names-indicator");
      const duplicateWarning = document.getElementById("names-duplicate-warning");

      if (indicator) indicator.textContent = `Đang nhập: ${count} người`;

      const duplicatedNames = getDuplicatedRacerNames(names);
      if (duplicateWarning) {
        if (duplicatedNames.length > 0) {
          duplicateWarning.textContent = `Tên trùng: ${duplicatedNames.join(", ")}. Vẫn có thể quay.`;
          duplicateWarning.style.display = "block";
        } else {
          duplicateWarning.textContent = "";
          duplicateWarning.style.display = "none";
        }
      }

      if (count > MAX_RACERS) {
        if (indicator) indicator.style.color = "var(--ruby)";
      } else {
        if (indicator) indicator.style.color = "var(--text-dim)";
      }

      syncRacerCheckState();
    }

    function generatePrizeInputs() {

      const count = parseInt(document.getElementById("prize-count-select").value);

      const container = document.getElementById("prizes-container");

      container.innerHTML = "";

      

      for (let i = 1; i <= count; i++) {

        const item = document.createElement("div");

        item.className = "prize-item";

        

        let medal = "🎁";

        if (i === 1) medal = "🥇";

        else if (i === 2) medal = "🥈";

        else if (i === 3) medal = "🥉";

        

        const savedVal = DEFAULT_PRIZES[i - 1] || `Giải ${i}`;

        

        item.innerHTML = `

          <div class="prize-rank">${medal} Top ${i}</div>

          <input type="text" class="prize-input" id="prize-input-${i}" value="${savedVal}">

        `;

        container.appendChild(item);

      }

    }



    function getCurrentWeekBounds(now = new Date()) {
      const vnOffsetMs = 7 * 60 * 60 * 1000;
      const vnNow = new Date(now.getTime() + vnOffsetMs);
      const dayOfWeek = vnNow.getUTCDay();
      const daysFromMonday = (dayOfWeek + 6) % 7;
      const startVnClockMs = Date.UTC(
        vnNow.getUTCFullYear(),
        vnNow.getUTCMonth(),
        vnNow.getUTCDate() - daysFromMonday,
        0,
        0,
        0,
        0
      );
      const startUtcMs = startVnClockMs - vnOffsetMs;
      const endUtcMs = startUtcMs + 7 * 24 * 60 * 60 * 1000;

      return {
        startIso: new Date(startUtcMs).toISOString(),
        endIso: new Date(endUtcMs).toISOString(),
        startDate: new Date(startUtcMs),
        endDate: new Date(endUtcMs),
        satDate: new Date(startUtcMs + 5 * 24 * 60 * 60 * 1000),
        sunDate: new Date(startUtcMs + 6 * 24 * 60 * 60 * 1000)
      };
    }

    function formatVietnamDate(date, options = {}) {
      return new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        ...options
      }).format(date);
    }

    function getNewestWeekendSessions(sessions) {
      const newest = { sat: null, sun: null };
      (Array.isArray(sessions) ? sessions : []).forEach((session) => {
        const day = String(session?.day || "").toLowerCase();
        if ((day === "sat" || day === "sun") && !newest[day]) {
          newest[day] = session;
        }
      });
      return newest;
    }

    function renderCurrentWeekImportCard(listContainer, sessionsByDay, weekBounds) {
      const satSession = sessionsByDay.sat;
      const sunSession = sessionsByDay.sun;
      const satCount = satSession ? getSessionMembersCount(satSession) : 0;
      const sunCount = sunSession ? getSessionMembersCount(sunSession) : 0;

      listContainer.innerHTML = "";

      if (!satSession && !sunSession) {
        const weekLabel = `${formatVietnamDate(weekBounds.startDate, { day: "2-digit", month: "2-digit" })} - ${formatVietnamDate(new Date(weekBounds.endDate.getTime() - 1), { day: "2-digit", month: "2-digit", year: "numeric" })}`;
        listContainer.innerHTML = `<div class="text-center" style="padding:20px;color:var(--text-dim);">📭 Không tìm thấy dữ liệu Bang Chiến Thứ 7/Chủ nhật trong tuần hiện tại (${weekLabel}).<br/><br/><button class="btn-action" style="margin-top:8px;" onclick="openSupabaseImportModal()">🔄 Thử lại</button></div>`;
        return;
      }

      const card = document.createElement("div");
      card.className = "weekend-import-card";

      const header = document.createElement("div");
      header.className = "weekend-import-header";

      const title = document.createElement("span");
      title.className = "weekend-title";
      title.textContent = `Tuần hiện tại: ${formatVietnamDate(weekBounds.satDate, { day: "2-digit", month: "2-digit" })} - ${formatVietnamDate(weekBounds.sunDate, { day: "2-digit", month: "2-digit", year: "numeric" })}`;
      header.appendChild(title);

      const importAllBtn = document.createElement("button");
      importAllBtn.className = "btn-import-all";
      importAllBtn.textContent = "Nhập Thứ 7 + Chủ nhật";
      importAllBtn.onclick = () => importCombinedRoster(satSession, sunSession);
      header.appendChild(importAllBtn);
      card.appendChild(header);

      if (!satSession || !sunSession) {
        const missing = !satSession ? "Thứ 7" : "Chủ nhật";
        const notice = document.createElement("div");
        notice.style.cssText = "font-size:11px;line-height:1.45;color:var(--gold);font-weight:700;";
        notice.textContent = `Chưa có dữ liệu ${missing} trong tuần này. Nút nhập gộp sẽ nhập ngày đang có dữ liệu.`;
        card.appendChild(notice);
      }

      const daysRow = document.createElement("div");
      daysRow.className = "weekend-days-row";

      [
        { label: "Thứ 7", session: satSession, count: satCount },
        { label: "Chủ nhật", session: sunSession, count: sunCount }
      ].forEach((item) => {
        const col = document.createElement("div");
        if (item.session) {
          col.className = "weekend-day-col";
          col.onclick = () => importRosterNames(item.session);
          col.innerHTML = `
            <span class="day-label">${item.label}</span>
            <span class="member-count">${item.count} Đấu Sĩ</span>
          `;
        } else {
          col.className = "weekend-day-col disabled";
          col.innerHTML = `
            <span class="day-label">${item.label}</span>
            <span class="member-count" style="color: var(--text-dim); background: none; border: none; padding: 0;">-</span>
          `;
        }
        daysRow.appendChild(col);
      });

      card.appendChild(daysRow);
      listContainer.appendChild(card);
    }

    // Mở modal nhập từ Supabase

    async function openSupabaseImportModal() {
      try {
        const modal = document.getElementById("supabase-modal");
        if (!modal) {
          console.error("[NHẬP BANG CHIẾN] Không tìm thấy element supabase-modal");
          alert("❌ Lỗi: Không tìm thấy modal! Vui lòng tải lại trang.");
          return;
        }
        
        modal.style.display = "flex";
        
        const listContainer = document.getElementById("supabase-sessions-list");
        if (!listContainer) {
          console.error("[NHẬP BANG CHIẾN] Không tìm thấy element supabase-sessions-list");
          return;
        }
        
        listContainer.innerHTML = '<div class="text-center" style="padding:20px;color:var(--emerald);">⏳ Đang tải dữ liệu bang chiến...</div>';
        
        if (!supabaseClient) {
          console.error("[NHẬP BANG CHIẾN] supabaseClient chưa được khởi tạo");
          listContainer.innerHTML = '<div class="text-center" style="padding:20px;color:var(--ruby);">❌ Không thể kết nối Supabase.<br/>Vui lòng kiểm tra kết nối mạng hoặc tải lại trang.<br/><br/><button class="btn-action" style="margin-top:8px;" onclick="openSupabaseImportModal()">🔄 Thử lại</button></div>';
          return;
        }

        const weekBounds = getCurrentWeekBounds();
        console.log("[NHẬP BANG CHIẾN] Đang query sessions tuần hiện tại từ Supabase...");
        const { data, error } = await supabaseClient
          .from('bc_sessions')
          .select('*')
          .eq('guild_id', GUILD_ID)
          .in('day', ['sat', 'sun'])
          .gte('created_at', weekBounds.startIso)
          .lt('created_at', weekBounds.endIso)
          .order('created_at', { ascending: false })
          .limit(20);
          
        if (error) {
          console.error("[NHẬP BANG CHIẾN] Lỗi query Supabase:", error);
          listContainer.innerHTML = `<div class="text-center" style="padding:20px;color:var(--ruby);">❌ Lỗi tải dữ liệu từ Supabase:<br/><code style="font-size:11px;color:var(--text-dim);">${error.message}</code><br/><br/><button class="btn-action" style="margin-top:8px;" onclick="openSupabaseImportModal()">🔄 Thử lại</button></div>`;
          return;
        }

        console.log("[NHẬP BANG CHIẾN] Đã tải", data?.length || 0, "sessions trong tuần hiện tại");
        renderCurrentWeekImportCard(listContainer, getNewestWeekendSessions(data), weekBounds);

      } catch(err) {
        console.error("[NHẬP BANG CHIẾN] Lỗi exception:", err);
        const listContainer = document.getElementById("supabase-sessions-list");
        if (listContainer) {
          listContainer.innerHTML = `<div class="text-center" style="padding:20px;color:var(--ruby);">❌ Có lỗi xảy ra:<br/><code style="font-size:11px;color:var(--text-dim);">${err.message || err}</code><br/><br/><button class="btn-action" style="margin-top:8px;" onclick="openSupabaseImportModal()">🔄 Thử lại</button></div>`;
        }
      }
    }



    function showLockedRandomMessage() {
      const modal = document.getElementById("locked-alert-modal");
      if (modal) {
        const titleSpan = modal.querySelector(".panel-header-title span");
        const bodyP = modal.querySelector("p");
        const subP = modal.querySelector("p + p");
        
        if (titleSpan) titleSpan.textContent = "🔒 TÍNH NĂNG TẠM KHÓA";
        if (bodyP) {
          bodyP.innerHTML = `Chức năng <strong>Random Game</strong> đang được khóa lại vì hiện tại chưa có game mới (chỉ có <strong>Đua Thú</strong> khả dụng).`;
        }
        if (subP) {
          subP.innerHTML = `Vui lòng chọn trực tiếp game hoạt động và nhấn <strong>Đấu Ngay</strong>!`;
        }
        modal.style.display = "flex";
      }
    }

    function showLockedGameMessage(gameName, statusMsg) {
      const modal = document.getElementById("locked-alert-modal");
      if (modal) {
        const titleSpan = modal.querySelector(".panel-header-title span");
        const bodyP = modal.querySelector("p");
        const subP = modal.querySelector("p + p");
        
        if (titleSpan) titleSpan.textContent = "🔒 TRÒ CHƠI CHƯA MỞ";
        if (bodyP) {
          bodyP.innerHTML = `Trò chơi <strong>${gameName}</strong> hiện tại đang khóa (${statusMsg}).`;
        }
        if (subP) {
          subP.innerHTML = `Vui lòng chọn <strong>Đua Thú</strong> và nhấn <strong>Đấu Ngay</strong>!`;
        }
        modal.style.display = "flex";
      }
    }

    function closeLockedAlertModal(event) {
      if (event) event.stopPropagation();
      const modal = document.getElementById("locked-alert-modal");
      if (modal) {
        modal.style.display = "none";
      }
    }

    function closeSupabaseImportModal(event) {
      document.getElementById("supabase-modal").style.display = "none";
    }

    function parseRosterJson(value, fallback) {
      if (Array.isArray(value) || (value && typeof value === "object")) return value;
      if (typeof value !== "string") return fallback;
      try {
        return JSON.parse(value || "");
      } catch(e) {
        return fallback;
      }
    }

    function extractRosterDisplayName(member) {
      if (!member || typeof member !== "object") return "";
      return String(
        member.gn ||
        member.game_username ||
        member.name ||
        member.username ||
        member.discord_name ||
        member.display_name ||
        ""
      ).trim();
    }

    // Trích xuất danh sách tên thành viên từ session
    function extractNamesFromSession(session) {
      if (!session) return [];
      const names = [];
      const seen = new Set();
      const addName = (member) => {
        const name = extractRosterDisplayName(member);
        const key = normalizeRacerName(name);
        if (!key || seen.has(key)) return;
        seen.add(key);
        names.push(name);
      };

      const dynamicSources = [
        parseRosterJson(session.teams, null),
        parseRosterJson(session.teams_json, null)
      ].filter((source) => source && typeof source === "object" && !Array.isArray(source));

      dynamicSources.forEach((teams) => {
        Object.values(teams).forEach((members) => {
          if (Array.isArray(members)) members.forEach(addName);
        });
      });

      const legacyKeys = ['team_attack1', 'team_attack2', 'team_defense', 'team_forest'];
      legacyKeys.forEach((key) => {
        const members = parseRosterJson(session[key], []);
        if (Array.isArray(members)) members.forEach(addName);
      });

      return names;
    }

    // Đếm tổng số lượng thành viên trong session
    function getSessionMembersCount(session) {
      return extractNamesFromSession(session).length;
    }

    function dedupeRacerNames(names) {
      const seen = new Set();
      return (Array.isArray(names) ? names : []).filter((name) => {
        const key = normalizeRacerName(name);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Nhập và gộp danh sách đấu sĩ từ cả Thứ Bảy và Chủ Nhật
    function importCombinedRoster(satSession, sunSession) {
      const satNames = extractNamesFromSession(satSession);
      const sunNames = extractNamesFromSession(sunSession);
      let combinedNames = dedupeRacerNames([...satNames, ...sunNames]);

      if (combinedNames.length > 0) {
        combinedNames = combinedNames.slice(0, MAX_RACERS);
        document.getElementById("names-input").value = combinedNames.join("\n");
        updateNamesCount();
        closeSupabaseImportModal();
      } else {
        alert("Không thể trích xuất tên thành viên nào từ cả hai buổi Thứ Bảy và Chủ Nhật.");
      }
    }

    // Nhập tên từ dữ liệu session
    function importRosterNames(session) {
      let names = dedupeRacerNames(extractNamesFromSession(session));

      if (names.length > 0) {
        // Loại bỏ trùng lặp và giới hạn tối đa theo cấu hình game
        names = names.slice(0, MAX_RACERS);
        document.getElementById("names-input").value = names.join("\n");
        updateNamesCount();
        closeSupabaseImportModal();
      } else {
        alert("Không thể trích xuất tên thành viên nào từ buổi bang chiến này.");
      }
    }






    // ─── HỆ THỐNG VÒNG QUAY NGẪU NHIÊN CHỌN TRÒ (DESTINY WHEEL) ───

    const GAMES_INFO = getRandomWheelEntries();



    let isSpinning = false;
    let wheelLabelsAnimationFrame = 0;

    const MINIGAME_MODULE_CONTEXT = {
      get legacy() {
        return window.__minigamesLegacyApi || {};
      }
    };

    let activeMinigameModule = null;

    function startGameByLegacyId(legacyId, names) {
      const game = getGameByLegacyId(legacyId) || getGameByLegacyId(1);
      if (!game) {
        alert("❌ Không tìm thấy cấu hình game. Vui lòng tải lại trang.");
        return;
      }
      if (!game.enabled) {
        showLockedGameMessage(game.name, game.status || "Đã đóng - Không khả dụng");
        return;
      }
      activeMinigameModule = game;
      return game.start(MINIGAME_MODULE_CONTEXT, names);
    }

    function cleanupActiveMinigameModule() {
      const game = activeMinigameModule;
      activeMinigameModule = null;
      if (game && typeof game.cleanup === "function") {
        game.cleanup(MINIGAME_MODULE_CONTEXT);
      }
    }

    function setSelectedLobbyGame(legacyId) {
      selectedGameLobbyId = legacyId;
      document.querySelectorAll(".game-card-lobby").forEach((card) => {
        const id = Number(String(card.id || "").replace("card-game-", ""));
        card.classList.toggle("active", id === legacyId && !card.classList.contains("disabled"));
      });
      syncDurationControlForSelectedGame();
      playTickSound(600, 0.05);
    }

    function syncDurationControlForSelectedGame() {
      const input = document.getElementById("race-duration-select");
      const label = document.getElementById("duration-val");
      const group = document.getElementById("duration-control-group");
      if (!input) return;

      const isFreeFallSelected = selectedGameLobbyId === 3;
      input.disabled = isFreeFallSelected;
      input.setAttribute("aria-disabled", String(isFreeFallSelected));
      group?.classList.toggle("duration-locked", isFreeFallSelected);

      if (label) {
        label.textContent = isFreeFallSelected
          ? `${input.value} giây • Đã khóa`
          : `${input.value} giây`;
      }
    }

    function bindSelectableGameCard(legacyId) {
      const card = document.getElementById(`card-game-${legacyId}`);
      if (!card || card.classList.contains("disabled")) return;
      card.addEventListener("click", () => setSelectedLobbyGame(legacyId));
    }

    function syncRandomButtonState() {
      const spinBtn = document.getElementById("btn-spin-start");
      if (!spinBtn) return;

      const hasRandomPool = getEnabledGames().length > 1;
      spinBtn.classList.toggle("locked", !hasRandomPool);
      spinBtn.onclick = hasRandomPool ? triggerRandomSelectionWheel : showLockedRandomMessage;
      spinBtn.textContent = hasRandomPool ? "🎲 RANDOM GAME" : "🔒 RANDOM GAME";
    }

    
    function getWheelLabel(name) {
      return String(name || "")
        .replace(/\s*3D\b/gi, "")
        .replace(/^Linh Ngọc\s*/i, "Plinko ")
        .replace(/^Đua\s*/i, "Đua ")
        .replace(/^Leo Tháp\s*/i, "Leo Tháp")
        .trim();
    }

    function drawDestinyWheel() {

      const canvas = document.getElementById("wheel-canvas");

      const ctx = canvas.getContext("2d");

      const size = canvas.parentElement.clientWidth;

      canvas.width = size * 2;

      canvas.height = size * 2;

      canvas.style.width = size + "px";

      canvas.style.height = size + "px";

      

      ctx.scale(2, 2);

      ctx.clearRect(0, 0, size, size);

      

      const cx = size / 2;

      const cy = size / 2;

      const r = size / 2 - 10;

      const numSectors = GAMES_INFO.length;

      const arc = (Math.PI * 2) / numSectors;

      

      for (let i = 0; i < numSectors; i++) {

        const angle = i * arc;

        ctx.fillStyle = GAMES_INFO[i].color;

        

        ctx.beginPath();

        ctx.moveTo(cx, cy);

        ctx.arc(cx, cy, r, angle, angle + arc);

        ctx.lineTo(cx, cy);

        ctx.fill();

        

        // Vẽ viền chia ô

        ctx.strokeStyle = "#030c05";

        ctx.lineWidth = 3;

        ctx.stroke();

        

      }

      drawDestinyWheelLabels(0);
    }

    function drawDestinyWheelLabels(rotationDeg = 0) {
      const canvas = document.getElementById("wheel-labels-canvas");
      const container = canvas?.parentElement;
      if (!canvas || !container || !GAMES_INFO.length) return;

      const size = container.clientWidth;
      const pixelRatio = 2;
      canvas.width = size * pixelRatio;
      canvas.height = size * pixelRatio;
      canvas.style.width = size + "px";
      canvas.style.height = size + "px";

      const ctx = canvas.getContext("2d");
      ctx.scale(pixelRatio, pixelRatio);
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const r = size / 2 - 16;
      const arc = (Math.PI * 2) / GAMES_INFO.length;
      const rotation = rotationDeg * Math.PI / 180;

      ctx.fillStyle = "#06120a";
      ctx.font = `900 ${Math.max(12, Math.min(15, size / 32))}px 'Inter', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      GAMES_INFO.forEach((game, index) => {
        const midAngle = index * arc + arc / 2 + rotation;
        const labelRadius = r * 0.55;
        const labelX = cx + Math.cos(midAngle) * labelRadius;
        const labelY = cy + Math.sin(midAngle) * labelRadius;
        ctx.fillText(getWheelLabel(game.name), labelX, labelY, r * 0.48);
      });
    }

    function getWheelRotation(wheel) {
      const transform = window.getComputedStyle(wheel).transform;
      if (!transform || transform === "none") return 0;
      const matrix = new DOMMatrixReadOnly(transform);
      return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    }

    function animateDestinyWheelLabels(wheel) {
      cancelAnimationFrame(wheelLabelsAnimationFrame);

      const update = () => {
        drawDestinyWheelLabels(getWheelRotation(wheel));
        if (isSpinning) {
          wheelLabelsAnimationFrame = requestAnimationFrame(update);
        }
      };

      wheelLabelsAnimationFrame = requestAnimationFrame(update);
    }



    function triggerRandomSelectionWheel() {

      if (isSpinning) return;

      

      // Kiểm tra tên hợp lệ

      const namesStr = document.getElementById("names-input").value;

      const names = namesStr.split("\n").map(n => n.trim()).filter(n => n.length > 0);

      

      if (!validateRacerNames(names)) return;



      isSpinning = true;

      initAudioContext();

      

      const overlay = document.getElementById("selector-overlay");

      overlay.style.display = "flex";

      

      drawDestinyWheel();

      

      const wheel = document.getElementById("wheel-outer");

      const banner = document.getElementById("selector-banner");

      

      // Xoay ngẫu nhiên

      const totalSectors = GAMES_INFO.length;

      const sectorArc = 360 / totalSectors;

      const targetSector = Math.floor(Math.random() * totalSectors); 

      const chosenGame = GAMES_INFO[targetSector];

      const spinAngle = (360 * 5) - (targetSector * sectorArc) - (sectorArc / 2); // 5 vòng

      

      wheel.style.transform = `rotate(${spinAngle}deg)`;
      animateDestinyWheelLabels(wheel);

      banner.innerHTML = `<span class="selector-result-main">Đang quay...</span><span class="selector-result-sub">Linh thú đang chọn trận đấu.</span>`;

      

      // Hiệu ứng âm thanh tick đồng bộ

      let lastAngle = 0;

      let tickTimer = setInterval(() => {

        const matrix = window.getComputedStyle(wheel).transform;

        if (matrix !== 'none') {

          const values = matrix.split('(')[1].split(')')[0].split(',');

          const a = values[0];

          const b = values[1];

          let currentRot = Math.round(Math.atan2(b, a) * (180/Math.PI));

          if (currentRot < 0) currentRot += 360;

          

          if (Math.abs(currentRot - lastAngle) > (360 / totalSectors)) {

            playTickSound(650, 0.03);

            lastAngle = currentRot;

          }

        }

      }, 50);



      setTimeout(() => {

        clearInterval(tickTimer);

        isSpinning = false;
        cancelAnimationFrame(wheelLabelsAnimationFrame);
        drawDestinyWheelLabels(getWheelRotation(wheel));

        

        // Phát tiếng chuông chiến thắng nhỏ

        if (canPlayGameAudio()) playTickSound(880, 0.15);

        setTimeout(() => { if (canPlayGameAudio()) playTickSound(1100, 0.25); }, 150);

        

        banner.innerHTML = `<span class="selector-result-main">Chọn được: ${chosenGame.name}</span><span class="selector-result-sub">Đang nạp động cơ WebGL...</span>`;

        

        setTimeout(() => {

          overlay.style.display = "none";

          wheel.style.transform = "rotate(0deg)";
          drawDestinyWheelLabels(0);

          startGameByLegacyId(chosenGame.id, names);

        }, 1800);

        

      }, 6200); // Khớp hoàn toàn thời gian transition trong CSS (6s + buffer)

    }



    function triggerDirectStartGame() {
      try {
        // Kiểm tra tên hợp lệ
        const namesInput = document.getElementById("names-input");
        if (!namesInput) {
          console.error("[ĐẤU NGAY] Không tìm thấy element names-input");
          alert("❌ Lỗi: Không tìm thấy ô nhập tên! Vui lòng tải lại trang.");
          return;
        }

        const namesStr = namesInput.value;
        const names = namesStr.split("\n").map(n => n.trim()).filter(n => n.length > 0);
        
        if (!validateRacerNames(names)) return;
        
        console.log("[ĐẤU NGAY] Khởi chạy trận đấu với", names.length, "đấu sĩ");
        initAudioContext();
        startGameByLegacyId(selectedGameLobbyId, names);
      } catch (error) {
        console.error("[ĐẤU NGAY] Lỗi khi khởi chạy trận đấu:", error);
        alert("❌ Có lỗi xảy ra khi khởi chạy trận đấu. Vui lòng thử lại!\n\nChi tiết lỗi: " + error.message);
      }
    }



    // Toggle Sidebar trên điện thoại

    function toggleMobileSidebar() {

      const sidebar = document.getElementById("arena-sidebar");

      sidebar.classList.toggle("show-mobile");

    }





    // ─── DỰ PHÒNG CHẠY ĐUA 2D (FALLBACK ENGINE) ───

    let fallbackLoopId = null;

    let fallbackIsRunning = false;

    let fallbackRacers = [];

    let fallbackTrackWidth = 0;

    let fallbackLaneHeight = 24;

    let fallbackRacerRadius = 10;

    let raceTimerStartMs = 0;

    let raceTimerDurationMs = 0;



    function formatRaceTimer(ms) {

      const totalSeconds = Math.max(0, Math.ceil(ms / 1000));

      const minutes = Math.floor(totalSeconds / 60);

      const seconds = totalSeconds % 60;

      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    }



    function resetRaceTimerDisplay(durationSeconds = null) {

      const timer = document.getElementById("race-timer");

      const value = document.getElementById("race-timer-value");

      const fill = document.getElementById("race-timer-fill");

      if (!timer) return;

      const seconds = durationSeconds ?? (parseInt(document.getElementById("race-duration-select").value) || 60);

      if (value) value.textContent = formatRaceTimer(seconds * 1000);

      if (fill) fill.style.transform = "scaleX(1)";

      timer.classList.remove("warning");

      timer.style.display = "none";

      raceTimerStartMs = 0;

      raceTimerDurationMs = 0;

    }



    function startRaceTimer(durationSeconds = null) {

      const timer = document.getElementById("race-timer");

      if (!timer) return;

      const seconds = durationSeconds ?? (parseInt(document.getElementById("race-duration-select").value) || 60);

      raceTimerStartMs = performance.now();

      raceTimerDurationMs = seconds * 1000;

      timer.style.display = "block";

      updateRaceTimerDisplay();

    }



    function updateRaceTimerDisplay() {

      const timer = document.getElementById("race-timer");

      const value = document.getElementById("race-timer-value");

      const fill = document.getElementById("race-timer-fill");

      if (!timer || !raceTimerStartMs || !raceTimerDurationMs) return;

      const elapsed = performance.now() - raceTimerStartMs;

      const remaining = raceTimerDurationMs - elapsed;

      const ratio = Math.max(0, Math.min(1, remaining / raceTimerDurationMs));

      if (value) value.textContent = formatRaceTimer(remaining);

      if (fill) fill.style.transform = `scaleX(${ratio})`;

      timer.classList.toggle("warning", remaining <= 10000);

    }



    function stopRaceTimer(keepVisible = false) {

      const timer = document.getElementById("race-timer");

      const value = document.getElementById("race-timer-value");

      const fill = document.getElementById("race-timer-fill");

      if (!timer) return;

      if (keepVisible) {

        if (value) value.textContent = "00:00";

        if (fill) fill.style.transform = "scaleX(0)";

        timer.classList.add("warning");

      } else {

        timer.style.display = "none";

        timer.classList.remove("warning");

        if (fill) fill.style.transform = "scaleX(1)";

      }

      raceTimerStartMs = 0;

      raceTimerDurationMs = 0;

    }



    function getRaceElapsedMs() {

      return raceTimerStartMs ? performance.now() - raceTimerStartMs : 0;

    }



    const DERBY_EFFECT_SMOOTH_MS = 420;



    function getRacerTimeProgress(racer, now = performance.now()) {

      if (!racer || !racer.plannedFinishMs) return 0;

      const targetOffset = (racer.timeBonusMs || 0) - (racer.timePenaltyMs || 0);

      if (typeof racer.visualTimeOffsetMs !== 'number') racer.visualTimeOffsetMs = targetOffset;

      if (typeof racer.timeOffsetUpdatedAt !== 'number') racer.timeOffsetUpdatedAt = now;



      const dt = Math.max(0, Math.min(80, now - racer.timeOffsetUpdatedAt));

      racer.timeOffsetUpdatedAt = now;

      const lerp = 1 - Math.exp(-dt / DERBY_EFFECT_SMOOTH_MS);

      racer.visualTimeOffsetMs += (targetOffset - racer.visualTimeOffsetMs) * lerp;

      if (Math.abs(targetOffset - racer.visualTimeOffsetMs) < 0.5) {

        racer.visualTimeOffsetMs = targetOffset;

      }



      const adjustedElapsed = getRaceElapsedMs() + racer.visualTimeOffsetMs;

      return Math.max(0, Math.min(1, adjustedElapsed / racer.plannedFinishMs));

    }



    function applyLightningPenalty(racer) {

      if (!racer || racer.finished) return;

      const penalty = Math.max(1200, Math.min(2600, raceTimerDurationMs * 0.075 || 1800));

      racer.timePenaltyMs = (racer.timePenaltyMs || 0) + penalty;

      racer.slowTimer = 110;

    }



    function applyBoostBonus(racer) {

      if (!racer || racer.finished) return;

      const bonus = Math.max(600, Math.min(1400, raceTimerDurationMs * 0.04 || 900));

      racer.timeBonusMs = (racer.timeBonusMs || 0) + bonus;

      racer.boostTimer = 80;

    }



    function getDerbyPrizeThreshold(racers) {

      const total = Array.isArray(racers) ? racers.length : 0;

      if (total <= 0) return 0;

      return Math.min(getSelectedPrizeCount(), total);

    }



    function hasDerbyFilledPrizeRanks(racers) {

      const threshold = getDerbyPrizeThreshold(racers);

      if (threshold <= 0) return true;

      return racers.filter(racer => racer && racer.finished).length >= threshold;

    }



    function getDerbyLightningTargets(racers) {

      if (!Array.isArray(racers) || hasDerbyFilledPrizeRanks(racers)) return [];

      return racers.filter(racer => racer && !racer.finished);

    }

    

    function startFallback2DGame(names) {

      console.log("Khởi động hệ thống đua 2D dự phòng...");

      const container = document.getElementById("webgl-container");

      const canvas = document.getElementById("fallback-canvas");

      canvas.style.display = "block";

      

      canvas.width = container.clientWidth;

      canvas.height = container.clientHeight;

      fallbackTrackWidth = canvas.width - 150; // Trừ vạch xuất phát/đích

      

      // Khởi tạo các đấu sĩ 2D dựa vào thời gian cấu hình

      const duration = getDerbySelectedDurationSeconds();

      const numRacers = names.length;

      fallbackRacers = [];

      resetRaceTimerDisplay(duration);
      showDerbyShowcaseActions(false);

      fallbackLaneHeight = canvas.height / numRacers;

      fallbackRacerRadius = Math.max(5, Math.min(14, fallbackLaneHeight * 0.32));

      

      const runDistance = fallbackTrackWidth - 40; // Khoảng cách từ xuất phát đến đích

      const totalFrames = duration * 60; // Số frame chạy giả định (60fps)

      const avgSpeedPerFrame = runDistance / totalFrames;



      names.forEach((name, i) => {

        const skin = MYTHICAL_BEAST_SKINS[i % MYTHICAL_BEAST_SKINS.length];

        fallbackRacers.push({

          name: name,

          startX: 40,

          x: 40, // xuất phát

          y: i * fallbackLaneHeight + fallbackLaneHeight / 2,

          speed: avgSpeedPerFrame,

          plannedFinishMs: duration * 1000 * (0.92 + Math.random() * 0.08),

          timePenaltyMs: 0,

          timeBonusMs: 0,

          visualTimeOffsetMs: 0,

          timeOffsetUpdatedAt: performance.now(),

          boostTimer: 0,

          slowTimer: 0,

          finished: false,

          finishTime: 0,

          color: skin.color,

          emoji: skin.emoji,

          rank: 0

        });

      });

      

      fallbackIsRunning = true;

      runFallbackCountdown();

    }



    function runFallbackCountdown() {

      const overlay = document.getElementById("countdown-overlay");

      const numEl = document.getElementById("countdown-number");

      overlay.style.display = "flex";

      

      let sec = 3;

      numEl.textContent = sec;

      numEl.classList.add("show");

      if (canPlayGameAudio()) playTickSound(440, 0.08);

      

      let timer = setInterval(() => {

        numEl.classList.remove("show");

        sec--;

        if (sec > 0) {

          setTimeout(() => {

            numEl.textContent = sec;

            numEl.classList.add("show");

            if (canPlayGameAudio()) playTickSound(440, 0.08);

          }, 50);

        } else if (sec === 0) {

          setTimeout(() => {

            numEl.textContent = "CHẠY!";

            numEl.classList.add("show");

            if (canPlayGameAudio()) playHornSound();

            updateCommentaryText("💥 Cuộc đua bùng nổ! Các đấu sĩ đang lao hết mình về phía trước!");

          }, 50);

        } else {

          clearInterval(timer);

          overlay.style.display = "none";

          // Bắt đầu di chuyển

          startRaceTimer();

          animateFallbackDerby();

        }

      }, 1000);

    }



    function animateFallbackDerby() {

      if (!fallbackIsRunning) return;

      

      const canvas = document.getElementById("fallback-canvas");

      const ctx = canvas.getContext("2d");

      const frameNow = performance.now();

      updateRaceTimerDisplay();

      

      // Xóa màn hình

      ctx.fillStyle = "#040e06";

      ctx.fillRect(0, 0, canvas.width, canvas.height);

      

      // Vẽ làn đường và vạch đích

      const numRacers = fallbackRacers.length;

      const laneHeight = canvas.height / numRacers;

      const racerRadius = Math.max(5, Math.min(14, laneHeight * 0.32));

      

      // Vẽ vạch đích

      ctx.strokeStyle = "rgba(251, 191, 36, 0.4)";

      ctx.setLineDash([5, 5]);

      ctx.lineWidth = 2;

      ctx.beginPath();

      ctx.moveTo(canvas.width - 100, 0);

      ctx.lineTo(canvas.width - 100, canvas.height);

      ctx.stroke();

      ctx.setLineDash([]);

      

      // Vẽ chữ FINISH

      ctx.fillStyle = "rgba(251,191,36,0.3)";

      ctx.font = "bold 20px 'Inter'";

      ctx.save();

      ctx.translate(canvas.width - 80, canvas.height / 2);

      ctx.rotate(Math.PI / 2);

      ctx.textAlign = "center";

      ctx.fillText("VẠCH ĐÍCH", 0, 0);

      ctx.restore();



      // Sự kiện ngẫu nhiên (chớp sấm sét)

      const lightningTargets = getDerbyLightningTargets(fallbackRacers);

      if (lightningTargets.length > 0 && Math.random() < 0.005) {

        triggerDerbyFlashEffect();

        playLightningSound();

        const struckRacer = lightningTargets[Math.floor(Math.random() * lightningTargets.length)];

        applyLightningPenalty(struckRacer);

        updateCommentaryText(`⚡ Thiên Lôi giáng sét làm chậm tốc chiến của [${struckRacer.name}]!`);


      }

      

      // Buff tăng tốc xuất hiện ngẫu nhiên

      if (Math.random() < 0.008) {

        const boostIdx = Math.floor(Math.random() * numRacers);

        if (!fallbackRacers[boostIdx].finished && fallbackRacers[boostIdx].slowTimer === 0) {

          applyBoostBonus(fallbackRacers[boostIdx]);

          playBoostSound();

          updateCommentaryText(`✨ Đấu sĩ [${fallbackRacers[boostIdx].name}] hấp thụ linh khí bứt tốc ngoạn mục!`);

        }

      }



      // Cập nhật vị trí các thần thú

      let finishedCount = fallbackRacers.filter(r => r.finished).length;

      let allFinished = true;

      

      fallbackRacers.forEach((racer) => {

        if (!racer.finished) {

          allFinished = false;

          

          const progress = getRacerTimeProgress(racer, frameNow);

          if (racer.boostTimer > 0) racer.boostTimer--;

          if (racer.slowTimer > 0) racer.slowTimer--;

          racer.x = racer.startX + (canvas.width - 100 - racer.startX) * progress;

          

          // Kiểm tra về đích

          if (progress >= 1) {

            racer.x = canvas.width - 100;

            racer.finished = true;

            finishedCount++;

            racer.rank = finishedCount;

            racer.finishTime = Date.now();
            racer.finishedAtMs = performance.now();

            playTickSound(700, 0.1);

            

            updateCommentaryText(`🏁 Đấu sĩ [${racer.name}] xuất sắc vượt qua vạch đích ở vị trí Top ${racer.rank}!`);

          }

        }

        

        // Vẽ làn chạy ngăn cách

        ctx.strokeStyle = "rgba(16, 185, 129, 0.08)";

        ctx.lineWidth = 1;

        ctx.beginPath();

        ctx.moveTo(0, racer.y - laneHeight / 2);

        ctx.lineTo(canvas.width, racer.y - laneHeight / 2);

        ctx.stroke();

        

        // Vẽ vệt chạy (particle trail đơn giản)

        if (racer.x > 40) {

          ctx.strokeStyle = racer.boostTimer > 0 ? "rgba(251, 191, 36, 0.4)" : "rgba(16, 185, 129, 0.2)";

          ctx.lineWidth = 3;

          ctx.beginPath();

          ctx.moveTo(40, racer.y);

          ctx.lineTo(racer.x, racer.y);

          ctx.stroke();

        }



        // Vẽ con thú (vẽ vòng tròn neon có emoji)

        ctx.fillStyle = racer.color;

        ctx.shadowBlur = 8;

        ctx.shadowColor = racer.color;

        ctx.beginPath();

        ctx.arc(racer.x, racer.y, racerRadius, 0, Math.PI * 2);

        ctx.fill();

        ctx.shadowBlur = 0; // reset

        

        ctx.fillStyle = "#fff";

        ctx.font = `${Math.max(8, Math.min(12, racerRadius * 0.9))}px 'Inter'`;

        ctx.textAlign = "center";

        ctx.fillText(racer.emoji, racer.x, racer.y + racerRadius * 0.32);

        

        // Tên bên cạnh

        ctx.fillStyle = "#fff";

        ctx.font = `bold ${Math.max(8, Math.min(11, laneHeight * 0.35))}px 'Inter'`;

        ctx.textAlign = "left";

        const maxNameWidth = Math.max(60, canvas.width - racer.x - 130);

        ctx.fillText(racer.name, racer.x + racerRadius + 6, racer.y + racerRadius * 0.3, maxNameWidth);

      });

      

      // Sắp xếp lại danh sách xếp hạng

      const sorted = [...fallbackRacers].sort((a, b) => {

        if (a.finished && b.finished) return a.rank - b.rank;

        if (a.finished) return -1;

        if (b.finished) return 1;

        return b.x - a.x; // Quãng đường lớn hơn xếp trên

      });

      

      updateLeaderboardUI(sorted);

      

      if (allFinished) {

        fallbackIsRunning = false;

        stopRaceTimer(true);

        playVictorySound();

        currentWinnersList = sorted;
        showDerbyShowcaseActions(true, { camera: false });
        updateCommentaryText("🏆 Cuộc đua hoàn tất! Bạn có thể copy kết quả hoặc trở về sảnh.");

      } else {

        fallbackLoopId = requestAnimationFrame(animateFallbackDerby);

      }

    }





    // ─── ĐỒ HỌA 3D WEBGL (THREE.JS ENGINE) ───

    let threeLoaded = false;

    let threeScene, threeCamera, threeRenderer;

    let threeIsRunning = false;

    let threeRacers = [];

    let threeLoopId = null;

    let trackLength = 120;

    let derbyLaneSpacing = DEFAULT_DERBY_LANE_SPACING;

    let derbyTrackWidth = getDerbyTrackWidth(1);
    let derbyCameraFocusZ = null;
    let derbyCameraLayer = null;
    let derbyRoadVisualRoot = null;
    let derbyPodiumGroup = null;
    let derbyPodiumSlots = [];
    let derbyPodiumWinners = [];
    let derbyPrizeCount = 3;
    let derbyPostRaceMode = false;
    let derbyShowcaseOrbitEnabled = true;
    let derbyShowcaseCameraState = null;
    const DERBY_BASE_ROAD_Y = -0.05;
    const DERBY_FINISH_Z = 10;
    const DERBY_PODIUM_Z = 4.2;
    const DERBY_PODIUM_FACE_YAW = 0;
    const DERBY_LABEL_DISTANCE_BASE = 24;
    const DERBY_LABEL_DISTANCE_RANGE = 36;
    const DERBY_LABEL_MAX_FAR_SCALE = 2.35;
    const DERBY_LEAD_COMPRESSION_RATIO = 0.12;
    const DERBY_LEAD_COMPRESSION_MIN_GAP = 18;
    const DERBY_LEAD_COMPRESSION_MAX_GAP = 42;
    const DERBY_LEAD_COMPRESSION_SMOOTH = 0.18;
    const derbyLabelWorldPos = { current: null };
    const derbyLabelAnchorPos = { current: null };
    const derbyLabelBodyPos = { current: null };
    let derbyLabelOverlay = null;



    function updateDerbyCameraFrame(focusZ, smooth = true) {

      if (!threeCamera || threeRacers.length === 0) return;



      const cameraCfg = getDerbyCameraConfig();
      const baseCamX = derbyTrackWidth / 2 - 1;
      const targetCamX = baseCamX + derbyNumber(cameraCfg.xOffset, 0);
      const targetLookX = baseCamX + derbyNumber(cameraCfg.lookXOffset, 0);

      const targetCamY = Math.max(
        derbyNumber(cameraCfg.minY, DERBY_CAMERA_MIN_Y),
        derbyTrackWidth * derbyNumber(cameraCfg.yWidthFactor, 0.42),
        DERBY_CAMERA_RACER_Y_REFERENCE * derbyNumber(cameraCfg.yRacerFactor, 0.28)
      );

      const targetCamZ = focusZ + Math.max(
        derbyNumber(cameraCfg.zOffsetBase, 24),
        derbyTrackWidth * derbyNumber(cameraCfg.zWidthFactor, 0.9)
      );

      const targetLookZ = Math.max(10, focusZ + derbyNumber(cameraCfg.lookZOffset, -10));

      const lerp = smooth ? derbyNumber(cameraCfg.smooth, 0.05) : 1;



      threeCamera.position.x += (targetCamX - threeCamera.position.x) * lerp;

      threeCamera.position.y += (targetCamY - threeCamera.position.y) * lerp;

      threeCamera.position.z += (targetCamZ - threeCamera.position.z) * lerp;

      threeCamera.lookAt(targetLookX, derbyNumber(cameraCfg.lookY, DERBY_CAMERA_LOOK_Y), targetLookZ);
      threeCamera.rotateZ(derbyDegToRad(cameraCfg.roll));
      updateDerbyCameraLayer(focusZ);

    }

    function getDerbyTempVector() {
      if (!derbyLabelWorldPos.current && window.THREE) {
        derbyLabelWorldPos.current = new THREE.Vector3();
      }
      return derbyLabelWorldPos.current;
    }

    function updateDerbyNameplateScales() {
      if (!threeCamera || !window.THREE) return;
      const worldPos = getDerbyTempVector();
      if (!worldPos) return;

      threeRacers.forEach((racer) => {
        const sprite = racer.nameSprite;
        if (!sprite || !racer.baseLabelScale) return;
        sprite.getWorldPosition(worldPos);
        const distance = threeCamera.position.distanceTo(worldPos);
        const farRatio = Math.max(0, Math.min(1, (distance - DERBY_LABEL_DISTANCE_BASE) / DERBY_LABEL_DISTANCE_RANGE));
        const farScale = 1 + farRatio * (DERBY_LABEL_MAX_FAR_SCALE - 1);
        sprite.scale.set(
          racer.baseLabelScale.x * farScale,
          racer.baseLabelScale.y * farScale,
          1
        );
      });
    }

    function updateNameplateRenderOrders() {
      if (!threeCamera || !window.THREE) return;
      const tempVec = getDerbyTempVector();
      if (!tempVec) return;

      const entries = threeRacers
        .filter((r) => r.nameSprite)
        .map((r) => {
          r.nameSprite.getWorldPosition(tempVec);
          return { sprite: r.nameSprite, z: tempVec.z };
        })
        .sort((a, b) => a.z - b.z);

      entries.forEach((entry, i) => {
        entry.sprite.renderOrder = 10 + i;
      });
    }

    function clampDerbyValue(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function getDerbyLogicalZ(racer) {
      if (!racer) return trackLength;
      const rawZ = Number(racer.rawZ);
      if (Number.isFinite(rawZ)) return rawZ;
      return derbyNumber(racer.z, trackLength);
    }

    function getDerbyVisualZ(racer) {
      if (!racer) return trackLength;
      const displayZ = Number(racer.displayZ);
      if (Number.isFinite(displayZ)) return displayZ;
      return getDerbyLogicalZ(racer);
    }

    function getDerbyMaxVisualLeadGap() {
      const runDistance = Math.max(1, trackLength - 10);
      return clampDerbyValue(
        runDistance * DERBY_LEAD_COMPRESSION_RATIO,
        DERBY_LEAD_COMPRESSION_MIN_GAP,
        DERBY_LEAD_COMPRESSION_MAX_GAP
      );
    }

    function sortDerbyRacersByTrueProgress(a, b) {
      if (a.finished && b.finished) return a.rank - b.rank;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return getDerbyLogicalZ(a) - getDerbyLogicalZ(b);
    }

    function applyDerbyLeaderVisualCompression() {
      if (!threeRacers.length) return;

      const ranked = [...threeRacers].sort(sortDerbyRacersByTrueProgress);
      const leader = ranked[0];
      const runnerUp = ranked[1];
      const previousLeaderDisplayZ = Number(leader?.displayZ);

      threeRacers.forEach((racer) => {
        const rawZ = getDerbyLogicalZ(racer);
        racer.displayZ = rawZ;
        racer.z = rawZ;
      });

      if (!leader || !runnerUp) return;

      const leaderRawZ = getDerbyLogicalZ(leader);
      const runnerUpRawZ = getDerbyLogicalZ(runnerUp);
      const maxGap = getDerbyMaxVisualLeadGap();
      const compressedTargetZ = Math.max(leaderRawZ, runnerUpRawZ - maxGap);
      const startZ = Number.isFinite(previousLeaderDisplayZ) ? previousLeaderDisplayZ : compressedTargetZ;
      let smoothedZ = startZ + (compressedTargetZ - startZ) * DERBY_LEAD_COMPRESSION_SMOOTH;

      if (compressedTargetZ > leaderRawZ) {
        smoothedZ = Math.max(compressedTargetZ, smoothedZ);
      } else {
        smoothedZ = Math.max(leaderRawZ, smoothedZ);
      }

      if (Math.abs(smoothedZ - compressedTargetZ) < 0.02) smoothedZ = compressedTargetZ;
      leader.displayZ = smoothedZ;
      leader.z = leader.displayZ;
    }

    function ensureDerbyLabelOverlay() {
      if (!derbyLabelOverlay) {
        derbyLabelOverlay = document.getElementById("derby-label-overlay");
      }
      return derbyLabelOverlay;
    }

    function createDerbyRaceLabel(name, color) {
      const label = document.createElement("div");
      label.className = "derby-race-label";
      label.style.setProperty("--label-color", color || "#10b981");
      label.innerHTML = `
        <span class="label-rank"></span>
        <span class="label-name">${escapeHtml(name || "")}</span>
      `;
      return label;
    }

    function clearDerbyRaceLabels() {
      const overlay = ensureDerbyLabelOverlay();
      if (overlay) overlay.innerHTML = "";
      threeRacers.forEach((racer) => {
        racer.labelEl = null;
      });
    }

    function getDerbyProjectedPoint(vector, overlayRect) {
      if (!threeCamera || !vector || !overlayRect) return null;
      vector.project(threeCamera);
      if (vector.z < -1 || vector.z > 1) return null;
      return {
        x: (vector.x * 0.5 + 0.5) * overlayRect.width,
        y: (-vector.y * 0.5 + 0.5) * overlayRect.height,
        z: vector.z
      };
    }

    function inflateDerbyRect(rect, amount) {
      return {
        left: rect.left - amount,
        top: rect.top - amount,
        right: rect.right + amount,
        bottom: rect.bottom + amount
      };
    }

    function derbyRectsIntersect(a, b) {
      return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    }

    function derbyOverlapArea(a, b) {
      const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return width * height;
    }

    function getDerbyReservedLabelRects(overlayRect) {
      const reserved = [];
      const timer = document.getElementById("race-timer");
      if (timer && timer.style.display !== "none") {
        const rect = timer.getBoundingClientRect();
        reserved.push(inflateDerbyRect({
          left: rect.left - overlayRect.left,
          top: rect.top - overlayRect.top,
          right: rect.right - overlayRect.left,
          bottom: rect.bottom - overlayRect.top
        }, 8));
      }
      return reserved;
    }

    function hideDerbyRaceLabel(label) {
      if (!label) return;
      label.classList.remove("visible", "leader", "compact", "soft", "finished-pop");
    }

    function hideAllDerbyRaceLabels() {
      threeRacers.forEach((racer) => hideDerbyRaceLabel(racer?.labelEl));
    }

    function getDerbyLabelMetrics(name, isLeader, compact, overlayWidth) {
      const isMobile = overlayWidth <= 720;
      const maxWidth = isLeader ? (isMobile ? 120 : 152) : compact ? (isMobile ? 76 : 96) : (isMobile ? 92 : 118);
      const minWidth = isLeader ? (isMobile ? 76 : 94) : compact ? (isMobile ? 44 : 52) : (isMobile ? 50 : 64);
      const charWidth = isLeader ? 7.1 : compact ? 4.9 : 5.7;
      const rankSpace = isLeader ? 30 : 20;
      return {
        width: clampDerbyValue(28 + String(name || "").length * charWidth + rankSpace, minWidth, maxWidth),
        height: isLeader ? (isMobile ? 28 : 32) : compact ? 18 : (isMobile ? 20 : 23)
      };
    }

    function buildDerbyLabelRect(anchorX, anchorY, metrics, overlayRect) {
      const x = clampDerbyValue(anchorX, metrics.width / 2 + 5, overlayRect.width - metrics.width / 2 - 5);
      const y = clampDerbyValue(anchorY, metrics.height + 8, overlayRect.height - 6);
      return {
        x,
        y,
        left: x - metrics.width / 2,
        right: x + metrics.width / 2,
        top: y - metrics.height,
        bottom: y
      };
    }

    function scoreDerbyLabelRect(rect, placedRects, bodyRects, reservedRects, dx, dy) {
      let labelPenalty = 0;
      let bodyPenalty = 0;
      placedRects.forEach((placed) => {
        labelPenalty += derbyOverlapArea(rect, placed) * 1.2;
      });
      bodyRects.forEach((body) => {
        bodyPenalty += derbyOverlapArea(rect, body) * 3.2;
      });
      reservedRects.forEach((reserved) => {
        bodyPenalty += derbyOverlapArea(rect, reserved) * 2.4;
      });
      return {
        total: labelPenalty + bodyPenalty + Math.abs(dx) * 0.18 + Math.abs(dy) * 0.08,
        bodyPenalty
      };
    }

    function getDerbyLabelCandidateOffsets(isLeader, compact) {
      if (isLeader) {
        return [
          [0, -6], [0, -34], [-34, -22], [34, -22], [0, -62], [-58, -48], [58, -48], [0, -90]
        ];
      }
      if (compact) {
        return [
          [0, -4], [-32, -16], [32, -16], [0, -34], [-56, -34], [56, -34],
          [0, -58], [-76, -54], [76, -54], [0, -82], [-96, -78], [96, -78]
        ];
      }
      return [
        [0, -6], [-42, -18], [42, -18], [0, -38], [-68, -42], [68, -42],
        [0, -68], [-92, -70], [92, -70], [0, -98]
      ];
    }

    function chooseDerbyLabelPlacement(item, placedRects, bodyRects, reservedRects, overlayRect) {
      const baseY = item.anchor.y - 16;
      let best = null;
      const compactModes = item.forceCompact ? [true] : [false, true];

      compactModes.forEach((compact) => {
        const metrics = getDerbyLabelMetrics(item.racer.name, item.isLeader, compact, overlayRect.width);
        getDerbyLabelCandidateOffsets(item.isLeader, compact).forEach(([dx, dy]) => {
          const rect = buildDerbyLabelRect(item.anchor.x + dx, baseY + dy, metrics, overlayRect);
          const score = scoreDerbyLabelRect(rect, placedRects, bodyRects, reservedRects, dx, dy);
          const candidate = { rect, compact, score };
          if (!best || candidate.score.total < best.score.total) best = candidate;
          if (score.total === 0 && (!best || !best.perfect)) best = { ...candidate, perfect: true };
        });
      });

      if (!best) return null;
      if (best.score.bodyPenalty > 0 && !item.isLeader) {
        best.compact = true;
        best.soft = true;
      }
      return best;
    }

    function updateDerbyRaceLabels(sortedRacers = []) {
      const overlay = ensureDerbyLabelOverlay();
      if (!overlay || !threeCamera || !window.THREE) return;

      const overlayRect = overlay.getBoundingClientRect();
      if (overlayRect.width <= 0 || overlayRect.height <= 0) return;
      if (!raceTimerStartMs || performance.now() - raceTimerStartMs < DERBY_LABEL_START_DELAY_MS) {
        hideAllDerbyRaceLabels();
        return;
      }

      const anchorVec = derbyLabelAnchorPos.current || (derbyLabelAnchorPos.current = new THREE.Vector3());
      const bodyVec = derbyLabelBodyPos.current || (derbyLabelBodyPos.current = new THREE.Vector3());
      const rankMap = new Map();
      sortedRacers.forEach((racer, index) => {
        rankMap.set(racer, racer.rank || index + 1);
      });

      const visibleItems = [];
      const bodyRects = [];

      threeRacers.forEach((racer) => {
        if (!racer?.group || !racer.labelEl) return;
        const groupPos = racer.group.position;
        anchorVec.set(groupPos.x, 2.34, groupPos.z);
        const anchor = getDerbyProjectedPoint(anchorVec, overlayRect);
        bodyVec.set(groupPos.x, 0.76, groupPos.z);
        const body = getDerbyProjectedPoint(bodyVec, overlayRect);

        if (!anchor || !body || anchor.x < -120 || anchor.x > overlayRect.width + 120 || anchor.y < -160 || anchor.y > overlayRect.height + 120) {
          hideDerbyRaceLabel(racer.labelEl);
          return;
        }

        const rank = rankMap.get(racer) || racer.rank || 999;
        const finishedPop = !!racer.finishedAtMs && performance.now() - racer.finishedAtMs <= DERBY_FINISH_LABEL_VISIBLE_MS;
        if (rank > DERBY_VISIBLE_LABEL_TOP_LIMIT && !finishedPop) {
          hideDerbyRaceLabel(racer.labelEl);
          return;
        }
        const isLeader = rank === 1;
        const forceCompact = rank > DERBY_LABEL_COMPACT_AFTER_RANK || finishedPop;
        const animalPad = isLeader ? 36 : 28;
        const bodyRect = {
          left: body.x - animalPad,
          right: body.x + animalPad,
          top: body.y - animalPad * 1.1,
          bottom: body.y + animalPad * 1.25
        };
        bodyRects.push(bodyRect);
        visibleItems.push({ racer, anchor, body, rank, isLeader, forceCompact, finishedPop });
      });

      const reservedRects = getDerbyReservedLabelRects(overlayRect);
      const placedRects = [];
      visibleItems
        .sort((a, b) => {
          if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
          if (a.rank !== b.rank) return a.rank - b.rank;
          return (a.racer.laneIndex || 0) - (b.racer.laneIndex || 0);
        })
        .forEach((item) => {
          const label = item.racer.labelEl;
          const placement = chooseDerbyLabelPlacement(item, placedRects, bodyRects, reservedRects, overlayRect);
          if (!placement) {
            hideDerbyRaceLabel(label);
            return;
          }

          const rankText = item.isLeader ? "Top 1" : `#${item.rank}`;
          const rankEl = label.querySelector(".label-rank");
          if (rankEl) rankEl.textContent = rankText;
          label.classList.toggle("leader", item.isLeader);
          label.classList.toggle("compact", (item.forceCompact || placement.compact) && !item.isLeader);
          label.classList.toggle("soft", !!placement.soft && !item.isLeader);
          label.classList.toggle("finished-pop", item.finishedPop && !item.isLeader);
          label.classList.add("visible");
          label.style.zIndex = String(item.isLeader ? 80 : item.finishedPop ? 70 : Math.max(12, 46 - item.rank));
          label.style.transform = `translate3d(${Math.round(placement.rect.x)}px, ${Math.round(placement.rect.y)}px, 0) translate(-50%, -100%)`;
          placedRects.push(placement.rect);
        });
    }

    function getDerbyPackCameraFocusZ() {
      const packZ = threeRacers
        .map(racer => getDerbyVisualZ(racer))
        .sort((a, b) => a - b);

      if (packZ.length === 0) return derbyCameraFocusZ ?? trackLength;
      if (packZ.length === 1) return packZ[0];

      const leadZ = packZ[0];
      const midPackZ = packZ[Math.min(packZ.length - 1, Math.floor(packZ.length * 0.52))];
      const tailPackZ = packZ[Math.min(packZ.length - 1, Math.floor(packZ.length * 0.78))];
      const rawFocusZ = leadZ * 0.28 + midPackZ * 0.46 + tailPackZ * 0.26;
      const clampedFocusZ = Math.max(10, Math.min(trackLength, rawFocusZ));

      if (derbyCameraFocusZ === null) derbyCameraFocusZ = clampedFocusZ;
      derbyCameraFocusZ += (clampedFocusZ - derbyCameraFocusZ) * 0.035;
      return derbyCameraFocusZ;
    }

    function getDerbyPodiumVisualRankIndex(rank) {
      return Math.max(0, derbyPodiumSlots.findIndex((slot) => slot.rank === rank));
    }

    function getDerbyPrizeText(rank) {
      return document.getElementById(`prize-input-${rank}`)?.value || `Giải ${rank}`;
    }

    function createDerbyPodiumLabel(rank) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 180;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(2, 10, 6, 0.84)";
      ctx.beginPath();
      ctx.roundRect(24, 24, 464, 124, 20);
      ctx.fill();
      ctx.strokeStyle = rank === 1 ? "#fbbf24" : "rgba(255,255,255,0.24)";
      ctx.lineWidth = rank === 1 ? 5 : 3;
      ctx.stroke();
      ctx.fillStyle = rank === 1 ? "#fff7cc" : "#f8fafc";
      ctx.font = "900 34px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${getResultMedal(rank)} Top ${rank}`, 256, 62);
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "800 24px 'Inter', sans-serif";
      ctx.fillText(getDerbyPrizeText(rank), 256, 108);
      const texture = new THREE.CanvasTexture(canvas);
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false });
      const sprite = new THREE.Sprite(material);
      sprite.renderOrder = 28;
      sprite.scale.set(2.2, 0.78, 1);
      return sprite;
    }

    function createDerbyLivePodium() {
      if (!threeScene) return;
      if (derbyPodiumGroup) threeScene.remove(derbyPodiumGroup);

      const prizeCount = derbyPrizeCount;
      const visualOrder = getPodiumVisualOrder(prizeCount);
      const spacing = prizeCount <= 3 ? Math.max(1.45, derbyLaneSpacing * 1.9) : Math.max(1.14, derbyLaneSpacing * 1.4);
      const centerX = derbyTrackWidth / 2 - 1;
      const centerOffset = (visualOrder.length - 1) / 2;

      derbyPodiumGroup = new THREE.Group();
      derbyPodiumGroup.name = "derby-live-podium";
      derbyPodiumSlots = [];
      derbyPodiumWinners = [];

      visualOrder.forEach((rank, index) => {
        const x = centerX + (index - centerOffset) * spacing;
        const height = getResultsPodiumHeight(rank);
        const block = createResultsPodiumBlock(rank, height);
        block.position.set(x, 0, DERBY_PODIUM_Z);
        derbyPodiumGroup.add(block);

        const label = createDerbyPodiumLabel(rank);
        label.position.set(x, 0.32, DERBY_PODIUM_Z + 0.9);
        derbyPodiumGroup.add(label);

        derbyPodiumSlots[rank] = {
          rank,
          x,
          y: height,
          z: DERBY_PODIUM_Z,
          label,
          occupied: false
        };
      });

      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(Math.max(4.2, spacing * visualOrder.length), 64),
        new THREE.MeshBasicMaterial({ color: "#06210d", transparent: true, opacity: 0.32, depthWrite: false })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(centerX, -0.02, DERBY_PODIUM_Z);
      derbyPodiumGroup.add(ground);

      threeScene.add(derbyPodiumGroup);
    }

    function assignDerbyFinishDestination(racer) {
      const prizeCount = derbyPrizeCount;
      if (racer.rank <= prizeCount && derbyPodiumSlots[racer.rank]) {
        const slot = derbyPodiumSlots[racer.rank];
        slot.occupied = true;
        racer.podiumSlot = slot;
        racer.climbingPodium = true;
        racer.onPodium = false;
        derbyPodiumWinners[racer.rank - 1] = racer;
        updateDerbyPodiumWinnerLabel(racer, slot);
        if (racer.rank === 1) attachDerbyChampionEffects(racer);
        return;
      }
      racer.finishedIdle = true;
    }

    function updateDerbyPodiumWinnerLabel(racer, slot) {
      if (!racer || !slot?.label?.material?.map) return;
      const canvas = slot.label.material.map.image;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(2, 10, 6, 0.86)";
      ctx.beginPath();
      ctx.roundRect(24, 22, 464, 132, 20);
      ctx.fill();
      ctx.strokeStyle = slot.rank === 1 ? "#fbbf24" : "rgba(255,255,255,0.28)";
      ctx.lineWidth = slot.rank === 1 ? 5 : 3;
      ctx.stroke();
      ctx.fillStyle = slot.rank === 1 ? "#fff7cc" : "#f8fafc";
      ctx.font = "900 31px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${getResultMedal(slot.rank)} Top ${slot.rank}`, 256, 52);
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 28px 'Inter', sans-serif";
      ctx.fillText(String(racer.name || "").slice(0, 22), 256, 92);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "800 20px 'Inter', sans-serif";
      ctx.fillText(getDerbyPrizeText(slot.rank), 256, 126);
      slot.label.material.map.needsUpdate = true;
    }

    function attachDerbyChampionEffects(racer) {
      if (!racer?.group || racer.group.userData.championEffects) return;
      const effects = new THREE.Group();
      effects.name = "derby-champion-effects";

      const haloMat = new THREE.MeshBasicMaterial({
        color: "#fbbf24",
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.026, 8, 54), haloMat);
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 1.05;
      effects.add(halo);

      const crown = createResultsPodiumCrown();
      crown.position.set(0, 1.16, 0.04);
      effects.add(crown);

      effects.userData.halo = halo;
      racer.group.add(effects);
      racer.group.userData.championEffects = effects;
    }

    function lerpDerbyAngle(current, target, amount) {
      const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
      return current + delta * amount;
    }

    function updateDerbyFinishedRacerPose(racer, frameNow) {
      if (!racer?.group) return;
      const target = racer.podiumSlot;
      if (!target) return;
      const wolf = racer.group.userData.wolf;
      const targetY = target.y + getBeastSurfaceOffset(wolf, 0.02) * (racer.group.scale?.y || 1);

      const lerp = 0.075;
      racer.group.position.x += (target.x - racer.group.position.x) * lerp;
      racer.group.position.y += (targetY - racer.group.position.y) * lerp;
      racer.group.position.z += (target.z - racer.group.position.z) * lerp;
      racer.z = racer.group.position.z;

      if (racer.podiumSlot) {
        const dx = Math.abs(racer.group.position.x - target.x);
        const dy = Math.abs(racer.group.position.y - targetY);
        const dz = Math.abs(racer.group.position.z - target.z);
        if (dx + dy + dz < 0.06) {
          racer.group.position.set(target.x, targetY, target.z);
          racer.onPodium = true;
          racer.climbingPodium = false;
        }
      }

      if (wolf) {
        const targetYaw = racer.podiumSlot ? DERBY_PODIUM_FACE_YAW : 0;
        wolf.rotation.y = lerpDerbyAngle(wolf.rotation.y, targetYaw, racer.podiumSlot ? 0.08 : 0.04);
        if (racer.onPodium) {
          racer.awardIdleAction = racer.awardIdleAction || wolf.userData.awardIdleAction || "stand";
          updateBeastIdlePose(wolf, racer.awardIdleAction, frameNow, {
            seed: racer.laneIndex || racer.rank || 0,
            neighborSide: racer.rank % 2 === 0 ? -1 : 1
          });
        } else {
          wolf.position.y = Math.sin(frameNow * 0.0025 + (racer.rank || 0)) * 0.018;
        }
      }
      const championEffects = racer.group.userData.championEffects;
      if (championEffects?.userData?.halo) {
        championEffects.userData.halo.rotation.z += 0.018;
      }
    }

    function showDerbyShowcaseActions(show, options = {}) {
      const actions = document.getElementById("derby-showcase-actions");
      if (actions) actions.style.display = show ? "flex" : "none";
      const toggle = document.getElementById("derby-camera-toggle-btn");
      if (toggle) {
        toggle.style.display = options.camera === false ? "none" : "";
        toggle.classList.toggle("active", derbyShowcaseOrbitEnabled);
        toggle.textContent = derbyShowcaseOrbitEnabled ? "⏸ Dừng camera" : "🎥 Di chuyển camera";
      }
    }

    function showPostGameActions(winners = [], options = {}) {
      if (Array.isArray(winners) && winners.length) currentWinnersList = winners;
      showDerbyShowcaseActions(true, { camera: false, ...options });
    }

    function startDerbyPostRaceShowcase(sortedRacers) {
      if (derbyPostRaceMode) return;
      derbyPostRaceMode = true;
      currentWinnersList = Array.isArray(sortedRacers) ? sortedRacers : [];
      derbyShowcaseOrbitEnabled = true;
      const centerX = derbyTrackWidth / 2 - 1;
      derbyShowcaseCameraState = {
        startedAt: performance.now(),
        durationMs: 3200,
        fromPos: threeCamera.position.clone(),
        targetX: centerX,
        targetY: 1.18,
        targetZ: DERBY_PODIUM_Z,
        baseCameraX: centerX,
        baseCameraY: 2.55,
        baseCameraZ: DERBY_PODIUM_Z - 5.8,
        orbitPhase: 0
      };
      showDerbyShowcaseActions(true);
      updateCommentaryText("🏆 Tất cả đã về đích! Camera đang chuyển sang bục vinh danh...");
    }

    function updateDerbyShowcaseCamera(frameNow) {
      if (!derbyPostRaceMode || !derbyShowcaseCameraState || !threeCamera) return false;
      const state = derbyShowcaseCameraState;
      const progress = Math.min(1, (frameNow - state.startedAt) / state.durationMs);
      const ease = 1 - Math.pow(1 - progress, 3);
      const driftElapsed = Math.max(0, frameNow - state.startedAt - state.durationMs);
      const drift = derbyShowcaseOrbitEnabled ? Math.min(1, driftElapsed / 10000) : 0;
      const truckX = drift * 1.35;
      const dollyZ = drift * 1.1;
      const targetPos = new THREE.Vector3(
        state.baseCameraX + truckX,
        state.baseCameraY,
        state.baseCameraZ - dollyZ
      );
      threeCamera.position.lerpVectors(state.fromPos, targetPos, ease);
      threeCamera.lookAt(state.targetX + truckX * 0.42, state.targetY, state.targetZ);
      updateDerbyCameraLayer(DERBY_FINISH_Z);
      return true;
    }

    window.toggleDerbyShowcaseOrbit = function() {
      derbyShowcaseOrbitEnabled = !derbyShowcaseOrbitEnabled;
      const toggle = document.getElementById("derby-camera-toggle-btn");
      if (toggle) {
        toggle.classList.toggle("active", derbyShowcaseOrbitEnabled);
        toggle.textContent = derbyShowcaseOrbitEnabled ? "⏸ Dừng camera" : "🎥 Di chuyển camera";
      }
    };



    // Bộ nhớ đệm tài nguyên hạt để tối ưu hóa hiệu năng cực đại

    let sharedGeometries = {};

    let sharedMaterials = {};

    let materialCache = {};
    let derbyTrackDecorations = [];
    let derbySpaceDecorations = [];



    function initSharedThreeResources() {

      if (!sharedGeometries.spark) {
        sharedGeometries.spark = new THREE.BoxGeometry(0.08, 0.08, 0.08);
        sharedGeometries.burn = new THREE.BoxGeometry(0.06, 0.06, 0.06);
        sharedGeometries.trail = new THREE.BoxGeometry(0.08, 0.08, 0.08);
      }

      if (!sharedGeometries.trackDash) {
        sharedGeometries.trackDash = new THREE.BoxGeometry(1, 0.035, 0.075);
        sharedGeometries.speedPad = new THREE.BoxGeometry(0.72, 0.028, 0.72);
        sharedGeometries.trackPylon = new THREE.CylinderGeometry(0.055, 0.085, 0.42, 10);
        sharedGeometries.hoverDisc = new THREE.CylinderGeometry(0.42, 0.62, 0.075, 30);
        sharedGeometries.hoverRing = new THREE.TorusGeometry(0.64, 0.026, 8, 40);
      }

      if (!sharedMaterials.burn) {
        sharedMaterials.burn = new THREE.MeshBasicMaterial({
          color: "#ef4444",
          transparent: true,
          opacity: 0.8
        });
      }

      if (!sharedMaterials.lightningBolt) {
        sharedMaterials.lightningBolt = new THREE.LineBasicMaterial({
          color: "#60a5fa",
          transparent: true,
          opacity: 0.95
        });
      }

    }



    function getCachedMaterial(colorStr, opacity = 0.9) {

      const key = `${colorStr}_${opacity}`;

      if (!materialCache[key]) {

        materialCache[key] = new THREE.MeshBasicMaterial({

          color: colorStr,

          transparent: true,

          opacity: opacity

        });

      }

      return materialCache[key];

    }

    

    // loadThreeJSDynamic được import từ ./three-loader.js

    // Hàm phóng chạy game chính

    async function launchSpeedDerbyGame(names) {

      derbyPrizeCount = getSelectedPrizeCount();

      document.getElementById("lobby-view").style.display = "none";

      document.getElementById("arena-view").style.display = "flex";

      if (typeof mngMusicSetMode === "function") mngMusicSetMode("playing");

      

      // Đặt bình luận mặc định

      updateCommentaryText("Đang kết nối động cơ đồ họa...");

      

      try {

        await loadThreeJSDynamic();

        initThreeDScene(names);

      } catch(e) {

        console.warn("Lỗi tải Three.js, chuyển sang engine 2D dự phòng:", e);

        startFallback2DGame(names);

      }

    }



    // Khởi tạo cảnh 3D

    function initThreeDScene(names) {

      const container = document.getElementById("webgl-container");

      const canvas = document.getElementById("webgl-canvas");

      canvas.style.display = "block";
      applyDerbySceneStyles();

      document.getElementById("fallback-canvas").style.display = "none";

      

      const duration = getDerbySelectedDurationSeconds();

      trackLength = duration * 10; // Chiều dài đường đua tỷ lệ thuận với thời gian đua

      resetRaceTimerDisplay(duration);
      showDerbyShowcaseActions(false);
      derbyPostRaceMode = false;
      derbyShowcaseCameraState = null;
      derbyShowcaseOrbitEnabled = true;
      derbyPodiumGroup = null;
      derbyPodiumSlots = [];
      derbyPodiumWinners = [];

      derbyLaneSpacing = getDerbyLaneSpacing(names.length);

      derbyTrackWidth = getDerbyTrackWidth(names.length);
      derbyCameraFocusZ = trackLength;

      

      const width = container.clientWidth;

      const height = container.clientHeight;

      

      // Scene

      threeScene = new THREE.Scene();
      threeScene.background = null;

      threeScene.fog = new THREE.FogExp2("#07180c", 0.0045);

      

      // Camera

      threeCamera = new THREE.PerspectiveCamera(derbyNumber(getDerbyCameraConfig().fov, 52), width / height, 0.1, 1000);

      

      // Renderer

      threeRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });

      threeRenderer.setSize(width, height);

      threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      threeRenderer.setClearColor(0x000000, 0);

      threeRenderer.shadowMap.enabled = true;

      

      // Ánh sáng

      const ambientLight = new THREE.AmbientLight("#112215", 1.5);

      threeScene.add(ambientLight);

      

      const dirLight = new THREE.DirectionalLight("#fbbf24", 2);

      dirLight.position.set(20, 50, 40);

      dirLight.castShadow = true;

      threeScene.add(dirLight);

      

      const pointLight = new THREE.PointLight("#10b981", 3, 100);

      pointLight.position.set(0, 10, 0);

      threeScene.add(pointLight);


      // Tạo đường chạy đua 3D

      buildThreeDRoadAndLanes(names.length);
      createDerbyLivePodium();

      

      // Khởi tạo các đấu sĩ

      initThreeDRacers(names);

      

      // Đặt camera bao trọn toàn bộ bề ngang đường đua ngay từ lúc xuất phát.

      threeCamera.position.set(derbyTrackWidth / 2 - 1, derbyNumber(getDerbyCameraConfig().minY, 9) + 1, trackLength + 18);

      updateDerbyCameraFrame(trackLength, false);
      updateDerbyNameplateScales();
      updateNameplateRenderOrders();

      const firstFrameNow = performance.now();
      animateDerbyTrackDecorations(firstFrameNow);
      animateDerbySpaceDecorations(firstFrameNow);
      if (threeRenderer && threeScene && threeCamera) {
        threeRenderer.render(threeScene, threeCamera);
      }

      

      threeIsRunning = true;

      

      // Lắng nghe resize màn hình

      window.addEventListener('resize', onThreeWindowResize);

      

      // Bắt đầu đếm ngược

      runThreeDCountdown();

    }



    // Vẽ nền móng đường đua 3D

    function addDerbyBackdrop(roadW = derbyTrackWidth) {
      if (!threeScene) return;

      const bg = getDerbyBackgroundConfig();
      const horizon = DERBY_SCENE_CONFIG.horizon || {};
      if (horizon.enabled === false || !bg.racetrack) return;
      if (isDerbyCameraLayerMode(bg)) {
        updateDerbyCameraLayer(derbyCameraFocusZ ?? trackLength);
        return;
      }

      const centerX = roadW / 2 - 1 + derbyNumber(horizon.x, 0);
      const horizonZ = derbyNumber(horizon.z, -82);
      const backdropBaseWidth = Math.max(roadW * 6, derbyNumber(horizon.width, 680));
      const backdropAspect = Math.max(0.1, derbyNumber(horizon.aspect, backdropBaseWidth / Math.max(1, derbyNumber(horizon.height, 382))));
      const backdropBaseHeight = derbyBool(horizon.lockAspect, true)
        ? backdropBaseWidth / backdropAspect
        : derbyNumber(horizon.height, Math.max(260, backdropBaseWidth * 0.56));
      const backdropWidth = backdropBaseWidth * derbyNumber(horizon.scale, 1);
      const backdropHeight = backdropBaseHeight * derbyNumber(horizon.scale, 1);
      const backdropY = derbyNumber(horizon.y, 132);
      const backdropGeo = new THREE.PlaneGeometry(backdropWidth, backdropHeight);
      const backdropMat = new THREE.MeshBasicMaterial({
        color: bg.racetrackTint || "#ffffff",
        transparent: true,
        opacity: derbyNumber(bg.racetrackOpacity, 0.66),
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: derbyBool(bg.racetrackDepthTest, false),
        fog: false,
        toneMapped: false
      });
      if (bg.racetrackBlending === "additive") backdropMat.blending = THREE.AdditiveBlending;
      backdropMat.color.multiplyScalar(derbyNumber(bg.racetrackBrightness, 1));
      const backdrop = new THREE.Mesh(backdropGeo, backdropMat);
      backdrop.position.set(centerX, backdropY, horizonZ);
      backdrop.rotation.set(
        derbyDegToRad(horizon.rotationX),
        derbyDegToRad(horizon.rotationY),
        derbyDegToRad(horizon.rotationZ)
      );
      backdrop.renderOrder = derbyNumber(horizon.renderOrder, -18);
      threeScene.add(backdrop);

      const loader = new THREE.TextureLoader();
      loader.load(bg.racetrack, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
        const repeatX = derbyNumber(bg.racetrackRepeatX, 1);
        const repeatY = derbyNumber(bg.racetrackRepeatY, 1);
        texture.wrapS = repeatX === 1 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        texture.wrapT = repeatY === 1 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        texture.repeat.set(repeatX, repeatY);
        texture.offset.set(derbyNumber(bg.racetrackOffsetX, 0), derbyNumber(bg.racetrackOffsetY, 0));
        texture.needsUpdate = true;
        backdropMat.map = texture;
        backdropMat.color.set(bg.racetrackTint || "#ffffff").multiplyScalar(derbyNumber(bg.racetrackBrightness, 1));
        backdropMat.opacity = derbyNumber(bg.racetrackOpacity, 0.66);
        backdropMat.needsUpdate = true;
      }, undefined, () => {
        backdropMat.color.set("#020705");
        backdropMat.opacity = 1;
        backdropMat.needsUpdate = true;
      });
    }

    function createDerbyHoverDisc(color, scale = 1) {
      initSharedThreeResources();
      const group = new THREE.Group();
      const discMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const disc = new THREE.Mesh(sharedGeometries.hoverDisc, discMat);
      disc.scale.set(scale, scale * 0.7, scale);
      group.add(disc);

      const ringMat = new THREE.MeshBasicMaterial({
        color: "#fbbf24",
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(sharedGeometries.hoverRing, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.scale.set(scale, scale, scale);
      group.add(ring);
      group.userData.disc = disc;
      group.userData.ring = ring;
      return group;
    }

    function createDerbyRoadVisualRoot(roadW) {
      if (!threeScene) return null;
      const roadCfg = getDerbyRoadConfig();
      const centerX = roadW / 2 - 1;
      const root = new THREE.Group();
      root.name = "derby-road-visual-root";
      root.position.set(centerX, derbyNumber(roadCfg.y, DERBY_BASE_ROAD_Y), 0);
      root.rotation.set(
        derbyDegToRad(roadCfg.pitch),
        derbyDegToRad(roadCfg.yaw),
        derbyDegToRad(roadCfg.roll)
      );
      root.userData.centerX = centerX;
      threeScene.add(root);
      return root;
    }

    function addDerbyRoadVisual(object) {
      if (!object) return object;
      if (!derbyRoadVisualRoot) {
        threeScene.add(object);
        return object;
      }
      object.position.x -= derbyNumber(derbyRoadVisualRoot.userData.centerX, 0);
      derbyRoadVisualRoot.add(object);
      return object;
    }

    function addDerbyTrackDecorations(roadW, laneSpacing, numLanes, roadMinZ, roadMaxZ) {
      if (!threeScene) return;
      initSharedThreeResources();
      derbyTrackDecorations = [];

      const centerX = roadW / 2 - 1;
      const roadLength = roadMaxZ - roadMinZ;
      const roadCenterZ = (roadMinZ + roadMaxZ) / 2;
      const dashMat = new THREE.MeshBasicMaterial({
        color: "#2ff29b",
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const padMats = ["#34d399", "#fbbf24", "#38bdf8"].map((color) => new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      }));
      const pylonMat = new THREE.MeshBasicMaterial({
        color: "#fbbf24",
        transparent: true,
        opacity: 0.58,
        depthWrite: false
      });
      const edgeMat = new THREE.MeshBasicMaterial({
        color: "#fbbf24",
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const edgeGeo = new THREE.BoxGeometry(0.045, 0.04, roadLength);

      [-1, roadW - 1].forEach((x, idx) => {
        const edge = new THREE.Mesh(edgeGeo, edgeMat.clone());
        edge.position.set(x, 0.018, roadCenterZ);
        addDerbyRoadVisual(edge);
        derbyTrackDecorations.push({
          type: "edge",
          mesh: edge,
          baseOpacity: idx === 0 ? 0.34 : 0.4,
          phase: idx * 1.4
        });
      });

      const dashStartZ = Math.ceil((roadMinZ + 4) / 12) * 12;
      for (let z = dashStartZ, dashIndex = 0; z <= roadMaxZ - 4; z += 12, dashIndex += 1) {
        const dash = new THREE.Mesh(sharedGeometries.trackDash, dashMat.clone());
        dash.scale.set(roadW * 0.86, 1, 1);
        dash.position.set(centerX, 0.025, z);
        addDerbyRoadVisual(dash);
        derbyTrackDecorations.push({ type: "dash", mesh: dash, baseOpacity: 0.22, phase: z * 0.17 });

        if (dashIndex % 3 === 0) {
          const laneCount = Math.max(numLanes, 1);
          const lane = dashIndex % laneCount;
          const pad = new THREE.Mesh(sharedGeometries.speedPad, padMats[lane % padMats.length].clone());
          pad.scale.set(Math.max(0.85, laneSpacing * 0.72), 1, 1.15);
          pad.position.set(lane * laneSpacing + laneSpacing / 2, 0.035, z + 3.2);
          addDerbyRoadVisual(pad);
          derbyTrackDecorations.push({ type: "pad", mesh: pad, baseOpacity: 0.22, phase: z * 0.23 });
        }
      }

      const pylonStartZ = Math.ceil((roadMinZ + 8) / 22) * 22;
      for (let z = pylonStartZ; z <= roadMaxZ - 8; z += 22) {
        [-1, 1].forEach((side) => {
          const pylon = new THREE.Mesh(sharedGeometries.trackPylon, pylonMat);
          pylon.position.set(side < 0 ? -1.22 : roadW - 0.78, 0.23, z);
          addDerbyRoadVisual(pylon);
          derbyTrackDecorations.push({ type: "pylon", mesh: pylon, baseY: pylon.position.y, phase: z * 0.13 });
        });
      }

      const droneCount = Math.min(8, Math.max(4, Math.ceil(roadLength / 80)));
      const droneColors = ["#34d399", "#fbbf24", "#38bdf8"];
      for (let i = 0; i < droneCount; i += 1) {
        const drone = createDerbyHoverDisc(droneColors[i % droneColors.length], 0.72);
        const side = i % 2 === 0 ? -1 : 1;
        const z = roadMinZ + 18 + i * ((roadLength - 36) / Math.max(1, droneCount - 1));
        drone.position.set(centerX + side * Math.min(roadW * 0.42, 9), 2.2 + (i % 3) * 0.28, z);
        addDerbyRoadVisual(drone);
        derbyTrackDecorations.push({
          type: "drone",
          mesh: drone,
          baseY: drone.position.y,
          spin: side * (0.014 + i * 0.0015),
          phase: i * 1.7
        });
      }
    }

    function animateDerbyTrackDecorations(frameNow) {
      if (!derbyTrackDecorations.length) return;
      derbyTrackDecorations.forEach((item) => {
        const mesh = item.mesh;
        if (!mesh) return;
        if (item.type === "drone") {
          mesh.rotation.y += item.spin;
          mesh.position.y = item.baseY + Math.sin(frameNow * 0.0022 + item.phase) * 0.16;
          if (mesh.userData.ring) mesh.userData.ring.rotation.z -= item.spin * 2.2;
          return;
        }
        if (item.type === "pylon") {
          mesh.position.y = item.baseY + Math.sin(frameNow * 0.004 + item.phase) * 0.035;
          return;
        }
        // Start/finish beam: pulsing glow
        if (item.type === "startBeam" || item.type === "finishBeam") {
          if (mesh.material) {
            mesh.material.opacity = item.baseOpacity + Math.sin(frameNow * 0.003 + item.phase) * 0.25;
          }
          return;
        }
        // Gate rings: spin fast + pulse opacity
        if (item.type === "gateRing") {
          mesh.rotation.z += item.spin;
          mesh.rotation.x += item.spin * 0.5;
          if (mesh.material) {
            mesh.material.opacity = item.baseOpacity + Math.sin(frameNow * 0.004 + item.phase) * 0.15;
          }
          return;
        }
        // Energy particles: bob up and down
        if (item.type === "energyParticle") {
          const baseY = mesh.position.y;
          const offset = Math.sin(frameNow * 0.003 + item.phase) * 0.15;
          mesh.position.y = baseY + offset;
          if (mesh.material) {
            mesh.material.opacity = item.baseOpacity + Math.sin(frameNow * 0.005 + item.phase) * 0.2;
          }
          return;
        }
        // Trophy gem: rotate + bob
        if (item.type === "trophyGem") {
          mesh.rotation.y += item.spin;
          mesh.position.y = item.baseY + Math.sin(frameNow * 0.003 + item.phase) * 0.2;
          return;
        }
        // Torch flames: flicker scale
        if (item.type === "torch") {
          const s = 0.85 + Math.sin(frameNow * 0.015 + item.phase) * 0.15;
          mesh.scale.set(s, s * 1.2, s);
          if (mesh.material) {
            mesh.material.opacity = item.baseOpacity + Math.sin(frameNow * 0.008 + item.phase) * 0.15;
          }
          return;
        }
        // Default: fade in/out
        const mat = mesh.material;
        if (mat && typeof mat.opacity === "number") {
          mat.opacity = item.baseOpacity + Math.sin(frameNow * 0.003 + item.phase) * 0.06;
        }
      });
    }

    function addDerbyStarField(roadW) {
      if (!threeScene) return;
      const starCfg = DERBY_SCENE_CONFIG.stars || {};
      if (starCfg.enabled === false) return;
      const centerX = roadW / 2 - 1;
      const starCount = Math.max(0, Math.min(900, Math.round(derbyNumber(starCfg.count, Math.min(520, Math.max(280, Math.round(roadW * 8)))))));
      const positions = new Float32Array(starCount * 3);
      const colors = new Float32Array(starCount * 3);
      const palette = (Array.isArray(starCfg.palette) && starCfg.palette.length ? starCfg.palette : ["#dffcf0", "#9ef9d4", "#fef3c7", "#93c5fd", "#f8fafc"]).map((color) => new THREE.Color(color));

      for (let i = 0; i < starCount; i += 1) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const farSky = i % Math.max(1, Math.round(derbyNumber(starCfg.farEvery, 7))) === 0;
        const xOffset = roadW * (farSky ? 0.95 : 0.72) + 7 + Math.random() * Math.max(24, derbyNumber(starCfg.spreadX, 48));
        const y = farSky
          ? derbyNumber(starCfg.farYMin, 15) + Math.random() * Math.max(1, derbyNumber(starCfg.farYMax, 53) - derbyNumber(starCfg.farYMin, 15))
          : derbyNumber(starCfg.nearYMin, 3.5) + Math.random() * Math.max(1, derbyNumber(starCfg.nearYMax, 33.5) - derbyNumber(starCfg.nearYMin, 3.5));
        const z = farSky
          ? derbyNumber(starCfg.farZMin, -90) + Math.random() * derbyNumber(starCfg.farZRange, 120)
          : derbyNumber(starCfg.nearZMin, -24) + Math.random() * (trackLength + derbyNumber(starCfg.nearZExtra, 88));
        const shade = palette[i % palette.length].clone().multiplyScalar(0.64 + Math.random() * 0.62);

        positions[i * 3] = centerX + side * xOffset;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        colors[i * 3] = shade.r;
        colors[i * 3 + 1] = shade.g;
        colors[i * 3 + 2] = shade.b;
      }

      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      starGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const starMat = new THREE.PointsMaterial({
        size: derbyNumber(starCfg.size, 0.16),
        sizeAttenuation: true,
        transparent: true,
        opacity: derbyNumber(starCfg.opacity, 0.82),
        vertexColors: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending
      });
      const stars = new THREE.Points(starGeo, starMat);
      stars.name = "derby-space-stars";
      stars.renderOrder = -8;
      threeScene.add(stars);
      derbySpaceDecorations.push({
        type: "starfield",
        mesh: stars,
        baseOpacity: derbyNumber(starCfg.opacity, 0.78),
        pulse: derbyNumber(starCfg.pulse, 0.14),
        phase: Math.random() * Math.PI,
        spin: derbyNumber(starCfg.spin, 0.000035)
      });
    }

    function addDerbyPlanetDecorations(roadW) {
      if (!threeScene) return;

      const centerX = roadW / 2 - 1;
      const sideBase = Math.max(10, roadW * 0.72);
      const planets = Array.isArray(DERBY_SCENE_CONFIG.planets) ? DERBY_SCENE_CONFIG.planets : [];

      planets.forEach((planet, index) => {
        if (planet.enabled === false) return;
        const group = new THREE.Group();
        const radius = derbyNumber(planet.radius, 1);
        group.name = `derby-planet-${planet.id || planet.name || index}`;
        const coreGeo = new THREE.SphereGeometry(radius, 14, 10);
        const coreMat = new THREE.MeshStandardMaterial({
          color: planet.color || "#e8d08a",
          emissive: planet.emissive || "#1f2937",
          emissiveIntensity: derbyNumber(planet.emissiveIntensity, 0.42),
          roughness: 0.64,
          metalness: 0.04,
          flatShading: true,
          fog: false
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        group.add(core);

        if (planet.bands) {
          ["#fff1b7", "#b7791f", "#facc15"].forEach((bandColor, bandIdx) => {
            const band = new THREE.Mesh(
              new THREE.TorusGeometry(radius * (0.86 + bandIdx * 0.08), 0.018, 6, 36),
              new THREE.MeshBasicMaterial({
                color: bandColor,
                transparent: true,
                opacity: 0.38,
                depthWrite: false,
                fog: false,
                blending: THREE.AdditiveBlending
              })
            );
            band.rotation.x = Math.PI / 2;
            band.position.y = (bandIdx - 1) * planet.radius * 0.23;
            group.add(band);
          });
        }

        if (planet.ring) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(radius * derbyNumber(planet.ringScale, 1.55), 0.045, 8, 56),
            new THREE.MeshBasicMaterial({
              color: planet.ringColor || "#fde68a",
              transparent: true,
              opacity: 0.62,
              side: THREE.DoubleSide,
              depthWrite: false,
              fog: false,
              blending: THREE.AdditiveBlending
            })
          );
          ring.rotation.x = Math.PI * 0.58;
          ring.rotation.z = Math.PI * 0.12;
          group.add(ring);
          group.userData.ring = ring;
        }

        if (planet.moon) {
          const moon = new THREE.Mesh(
            new THREE.SphereGeometry(derbyNumber(planet.moonRadius, 0.22), 10, 8),
            new THREE.MeshBasicMaterial({ color: "#e5e7eb", transparent: true, opacity: 0.86, fog: false })
          );
          moon.position.set(radius * 1.65, radius * 0.42, 0);
          group.add(moon);
          group.userData.moon = moon;
        }

        const side = derbyNumber(planet.side, index % 2 === 0 ? -1 : 1);
        const z = Number.isFinite(Number(planet.absZ))
          ? derbyNumber(planet.absZ, 18)
          : Math.max(18, Math.min(trackLength - 12, trackLength * derbyNumber(planet.z, 0.5)));
        const x = Number.isFinite(Number(planet.x))
          ? centerX + derbyNumber(planet.x, 0)
          : centerX + side * (sideBase + derbyNumber(planet.extra, 0) + index * 0.42);
        group.position.set(x, derbyNumber(planet.y, 7), z);
        group.rotation.y = derbyNumber(planet.rotationY, index * 0.7);
        group.rotation.z = derbyNumber(planet.rotationZ, side * 0.08);
        threeScene.add(group);

        derbySpaceDecorations.push({
          type: "planet",
          mesh: group,
          baseY: derbyNumber(planet.y, 7),
          spin: derbyNumber(planet.spin, 0.003) * side,
          bobAmplitude: derbyNumber(planet.bobAmplitude, DERBY_SCENE_CONFIG.effects?.planetBobAmplitude ?? 0.18),
          phase: index * 0.9
        });
      });
    }

    function animateDerbySpaceDecorations(frameNow) {
      if (!derbySpaceDecorations.length) return;
      const effects = DERBY_SCENE_CONFIG.effects || {};
      derbySpaceDecorations.forEach((item) => {
        const mesh = item.mesh;
        if (!mesh) return;

        if (item.type === "starfield") {
          mesh.rotation.y += item.spin;
          if (mesh.material && typeof mesh.material.opacity === "number") {
            const pulse = derbyBool(effects.starPulse, true) ? derbyNumber(item.pulse, 0.14) : 0;
            mesh.material.opacity = item.baseOpacity + Math.sin(frameNow * 0.0018 + item.phase) * pulse;
          }
          return;
        }

        if (item.type === "planet") {
          mesh.rotation.y += item.spin;
          const bob = derbyBool(effects.planetBob, true) ? derbyNumber(item.bobAmplitude, 0.18) : 0;
          mesh.position.y = item.baseY + Math.sin(frameNow * derbyNumber(effects.planetBobSpeed, 0.0012) + item.phase) * bob;
          if (mesh.userData.ring) mesh.userData.ring.rotation.z += item.spin * 0.9;
          if (mesh.userData.moon && derbyBool(effects.moonOrbit, true)) {
            const angle = frameNow * derbyNumber(effects.moonOrbitSpeed, 0.0016) + item.phase;
            mesh.userData.moon.position.x = Math.cos(angle) * 1.75;
            mesh.userData.moon.position.z = Math.sin(angle) * 1.75;
          }
          return;
        }

        if (item.type === "custom") {
          animateDerbyCustomObject(item, frameNow);
        }
      });
    }

    function createDerbyConfiguredMaterial(material = {}, preferStandard = false) {
      const base = {
        color: material.color || "#10b981",
        transparent: true,
        opacity: derbyNumber(material.opacity, 0.82),
        side: THREE.DoubleSide,
        depthWrite: material.depthWrite === true,
        fog: material.fog === true
      };
      if (material.blending === "additive") base.blending = THREE.AdditiveBlending;
      if (preferStandard || material.emissive) {
        return new THREE.MeshStandardMaterial({
          ...base,
          emissive: material.emissive || "#000000",
          emissiveIntensity: derbyNumber(material.emissiveIntensity, material.emissive ? 0.45 : 0),
          roughness: derbyNumber(material.roughness, 0.55),
          metalness: derbyNumber(material.metalness, 0.05)
        });
      }
      return new THREE.MeshBasicMaterial(base);
    }

    function addDerbyCustomObjects(roadW) {
      if (!threeScene || !Array.isArray(DERBY_SCENE_CONFIG.customObjects)) return;
      const centerX = roadW / 2 - 1;
      const loader = new THREE.TextureLoader();

      DERBY_SCENE_CONFIG.customObjects.forEach((object, index) => {
        if (!object || object.enabled === false) return;
        const type = object.type || "sphere";
        const material = object.material || {};
        const transform = getDerbyObjectTransform(object);
        let mesh = null;

        if (type === "light") {
          const lightType = material.lightType || "point";
          const color = material.color || "#fbbf24";
          const intensity = derbyNumber(material.intensity, 1.8);
          if (lightType === "ambient") mesh = new THREE.AmbientLight(color, intensity);
          else if (lightType === "directional") mesh = new THREE.DirectionalLight(color, intensity);
          else mesh = new THREE.PointLight(color, intensity, derbyNumber(material.distance, 60));
          mesh.name = object.name || `custom-light-${index}`;
          applyDerbyTransform(mesh, { ...transform, x: centerX + derbyNumber(transform.x, 0) });
          threeScene.add(mesh);
          derbySpaceDecorations.push({ type: "custom", mesh, baseY: mesh.position.y, baseScale: mesh.scale.clone(), animation: object.animation || {}, phase: index * 0.77 });
          if (!object.showHelper) return;
          const helper = new THREE.Mesh(
            new THREE.SphereGeometry(0.16, 10, 8),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
          );
          helper.position.copy(mesh.position);
          helper.name = `${mesh.name}-helper`;
          threeScene.add(helper);
          derbySpaceDecorations.push({ type: "custom", mesh: helper, baseY: helper.position.y, baseScale: helper.scale.clone(), animation: object.animation || {}, phase: index * 0.77 });
          return;
        }

        if (type === "imagePlane") {
          mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createDerbyConfiguredMaterial(material));
          const src = object.src || material.src;
          if (src) {
            loader.load(src, (texture) => {
              texture.colorSpace = THREE.SRGBColorSpace || texture.colorSpace;
              texture.needsUpdate = true;
              mesh.material.map = texture;
              mesh.material.color.set("#ffffff");
              mesh.material.needsUpdate = true;
            });
          }
        } else if (type === "plane") {
          mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), createDerbyConfiguredMaterial(material));
        } else if (type === "circle") {
          mesh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), createDerbyConfiguredMaterial(material));
        } else if (type === "box") {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), createDerbyConfiguredMaterial(material, true));
        } else if (type === "cylinder") {
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 32), createDerbyConfiguredMaterial(material, true));
        } else if (type === "torus" || type === "ring") {
          mesh = new THREE.Mesh(
            new THREE.TorusGeometry(0.45, derbyNumber(material.tube, type === "ring" ? 0.025 : 0.08), 10, 64),
            createDerbyConfiguredMaterial({ blending: "additive", ...material })
          );
        } else {
          mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), createDerbyConfiguredMaterial(material, true));
        }

        mesh.name = object.name || `custom-${type}-${index}`;
        applyDerbyTransform(mesh, { ...transform, x: centerX + derbyNumber(transform.x, 0) });
        mesh.renderOrder = derbyNumber(object.renderOrder, 0);
        threeScene.add(mesh);
        derbySpaceDecorations.push({
          type: "custom",
          mesh,
          baseY: mesh.position.y,
          baseScale: mesh.scale.clone(),
          animation: object.animation || {},
          phase: index * 0.77
        });
      });
    }

    function getDerbyObjectTransform(object = {}) {
      const transform = { ...(object.transform || {}) };
      if (object.lockAspect) {
        const aspect = Math.max(0.1, derbyNumber(object.aspect, 1));
        transform.sy = derbyNumber(transform.sx, 1) / aspect;
      }
      return transform;
    }

    function animateDerbyCustomObject(item, frameNow) {
      const mesh = item.mesh;
      const animation = item.animation || {};
      const effects = DERBY_SCENE_CONFIG.effects || {};
      if (!mesh || animation.enabled === false) return;

      if (derbyBool(effects.customSpin, true) && animation.spin) {
        mesh.rotation.x += derbyDegToRad(animation.spinX || 0);
        mesh.rotation.y += derbyDegToRad(animation.spinY || 0);
        mesh.rotation.z += derbyDegToRad(animation.spinZ || 0);
      }

      if (derbyBool(effects.customBob, true) && animation.bob) {
        mesh.position.y = item.baseY + Math.sin(frameNow * derbyNumber(animation.bobSpeed, 0.002) + item.phase) * derbyNumber(animation.bobAmplitude, 0.22);
      }

      if (derbyBool(effects.customPulse, true) && animation.pulse && item.baseScale) {
        const pulse = 1 + Math.sin(frameNow * derbyNumber(animation.pulseSpeed, 0.003) + item.phase) * derbyNumber(animation.pulseAmount, 0.08);
        mesh.scale.set(item.baseScale.x * pulse, item.baseScale.y * pulse, item.baseScale.z * pulse);
        if (mesh.material && typeof mesh.material.opacity === "number") {
          const baseOpacity = derbyNumber(animation.baseOpacity, mesh.material.opacity);
          mesh.material.opacity = Math.max(0, Math.min(1, baseOpacity + Math.sin(frameNow * derbyNumber(animation.pulseSpeed, 0.003) + item.phase) * derbyNumber(animation.opacityPulse, 0)));
        }
      }
    }

    function addDerbyStartGate(roadW) {
      if (!threeScene) return;

      const gateZ = trackLength;
      const centerX = roadW / 2 - 1;

      // Two arch pillars
      const pillarMat = new THREE.MeshStandardMaterial({
        color: "#fbbf24",
        emissive: "#7c2d12",
        emissiveIntensity: 0.35,
        metalness: 0.8,
        roughness: 0.3
      });

      [[-0.8, 1.5], [roadW - 1.2, 1.5]].forEach(([px, py], pi) => {
        const pillarGeo = new THREE.BoxGeometry(0.2, 3.2, 0.2);
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(px, py, gateZ);
        addDerbyRoadVisual(pillar);

        [0.4, 1.2, 2.0].forEach((ringY, ri) => {
          const rGeo = new THREE.TorusGeometry(0.18, 0.04, 8, 20);
          const rMat = new THREE.MeshBasicMaterial({
            color: ri === 1 ? "#fbbf24" : "#10b981",
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
          });
          const ring = new THREE.Mesh(rGeo, rMat);
          ring.position.set(px, ringY, gateZ);
          ring.rotation.x = Math.PI / 2;
          addDerbyRoadVisual(ring);
          derbyTrackDecorations.push({
            type: "pillarRing",
            mesh: ring,
            baseOpacity: 0.5,
            phase: pi * 2.1 + ri * 1.3,
            spin: 0.008
          });
        });
      });

      // Crossbeam glowing bar
      const beamGeo = new THREE.BoxGeometry(roadW + 0.5, 0.14, 0.14);
      const beamMat = new THREE.MeshBasicMaterial({
        color: "#fbbf24",
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const crossbeam = new THREE.Mesh(beamGeo, beamMat);
      crossbeam.position.set(centerX, 3.1, gateZ);
      addDerbyRoadVisual(crossbeam);
      derbyTrackDecorations.push({
        type: "startBeam",
        mesh: crossbeam,
        baseOpacity: 0.55,
        phase: 0,
        spin: 0
      });

      // Energy burst particles
      for (let i = 0; i < 14; i++) {
        const pGeo = new THREE.SphereGeometry(0.07, 4, 4);
        const pMat = new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? "#fbbf24" : "#10b981",
          transparent: true,
          opacity: 0.8,
          blending: THREE.AdditiveBlending
        });
        const particle = new THREE.Mesh(pGeo, pMat);
        const angle = (i / 14) * Math.PI * 2;
        const radius = 0.3 + Math.random() * 0.4;
        particle.position.set(
          centerX + Math.cos(angle) * radius,
          0.5 + Math.random() * 2.6,
          gateZ + (Math.random() - 0.5) * 0.3
        );
        addDerbyRoadVisual(particle);
        derbyTrackDecorations.push({
          type: "energyParticle",
          mesh: particle,
          baseOpacity: 0.6,
          phase: i * 0.45,
          spin: 0
        });
      }

      // Ethereal portal rings
      for (let i = 0; i < 5; i++) {
        const rGeo = new THREE.TorusGeometry(roadW * 0.13 + i * 0.28, 0.045, 8, 40);
        const rMat = new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? "#10b981" : "#fbbf24",
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const ring = new THREE.Mesh(rGeo, rMat);
        ring.position.set(centerX, 1.5, gateZ + 2.5 + i * 1.2);
        addDerbyRoadVisual(ring);
        derbyTrackDecorations.push({
          type: "gateRing",
          mesh: ring,
          baseOpacity: 0.25,
          phase: i * 1.1,
          spin: 0.012 + i * 0.004
        });
      }
    }

    function addDerbyFinishArch(roadW) {
      if (!threeScene) return;

      const centerX = roadW / 2 - 1;
      const finishZ = 10;

      // Finish arch pillars
      const finPillarMat = new THREE.MeshStandardMaterial({
        color: "#fbbf24",
        emissive: "#92400e",
        emissiveIntensity: 0.4,
        metalness: 0.85,
        roughness: 0.25
      });

      [[-0.8, 2.0], [roadW - 1.2, 2.0]].forEach(([px, py], pi) => {
        const pGeo = new THREE.BoxGeometry(0.22, 4.2, 0.22);
        const pillar = new THREE.Mesh(pGeo, finPillarMat);
        pillar.position.set(px, py, finishZ);
        addDerbyRoadVisual(pillar);

        [0.5, 1.5, 2.5, 3.5].forEach((ringY, ri) => {
          const rGeo = new THREE.TorusGeometry(0.2, 0.045, 8, 24);
          const rMat = new THREE.MeshBasicMaterial({
            color: ri % 2 === 0 ? "#fbbf24" : "#f97316",
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending
          });
          const ring = new THREE.Mesh(rGeo, rMat);
          ring.position.set(px, ringY, finishZ);
          ring.rotation.x = Math.PI / 2;
          addDerbyRoadVisual(ring);
          derbyTrackDecorations.push({
            type: "finishPillarRing",
            mesh: ring,
            baseOpacity: 0.6,
            phase: pi * 1.8 + ri * 0.9,
            spin: 0.01
          });
        });
      });

      // Finish crossbeam
      const finBeamGeo = new THREE.BoxGeometry(roadW + 0.6, 0.16, 0.16);
      const finBeamMat = new THREE.MeshBasicMaterial({
        color: "#fbbf24",
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const finBeam = new THREE.Mesh(finBeamGeo, finBeamMat);
      finBeam.position.set(centerX, 4.15, finishZ);
      addDerbyRoadVisual(finBeam);
      derbyTrackDecorations.push({
        type: "finishBeam",
        mesh: finBeam,
        baseOpacity: 0.7,
        phase: 0.5,
        spin: 0
      });

      // Trophy gem
      const gemGeo = new THREE.OctahedronGeometry(0.5, 0);
      const gemMat = new THREE.MeshStandardMaterial({
        color: "#fef3c7",
        emissive: "#fbbf24",
        emissiveIntensity: 1.2,
        metalness: 1,
        roughness: 0
      });
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.set(centerX, 4.65, finishZ);
      addDerbyRoadVisual(gem);
      derbyTrackDecorations.push({
        type: "trophyGem",
        mesh: gem,
        baseY: gem.position.y,
        phase: 0,
        spin: 0.018
      });

      // Torch flames
      const torchPositions = [
        [-0.5, 2.8], [roadW - 1.5, 2.8],
        [-0.5, 3.5], [roadW - 1.5, 3.5]
      ];
      torchPositions.forEach(([tx, ty], ti) => {
        const fGeo = new THREE.SphereGeometry(0.18, 8, 8);
        const fMat = new THREE.MeshBasicMaterial({
          color: ti % 2 === 0 ? "#ef4444" : "#f97316",
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending
        });
        const flame = new THREE.Mesh(fGeo, fMat);
        flame.position.set(tx, ty, finishZ);
        addDerbyRoadVisual(flame);
        derbyTrackDecorations.push({
          type: "torch",
          mesh: flame,
          baseOpacity: 0.7,
          phase: ti * 1.2,
          spin: 0
        });
      });

      // Finish area energy beads
      for (let z = finishZ + 0.5; z < finishZ + 12; z += 1.5) {
        for (let side = -1; side <= 1; side += 2) {
          const bGeo = new THREE.SphereGeometry(0.08, 4, 4);
          const bMat = new THREE.MeshBasicMaterial({
            color: side === -1 ? "#fbbf24" : "#10b981",
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
          });
          const bead = new THREE.Mesh(bGeo, bMat);
          bead.position.set(side * (roadW / 2 + 0.3), 0.1, z);
          addDerbyRoadVisual(bead);
          derbyTrackDecorations.push({
            type: "finishBead",
            mesh: bead,
            baseOpacity: 0.5,
            phase: z * 0.3 + side,
            spin: 0
          });
        }
      }

      // FINISH banner panels
      const bannerCanvas = document.createElement("canvas");
      bannerCanvas.width = 512;
      bannerCanvas.height = 320;
      const bCtx = bannerCanvas.getContext("2d");

      bCtx.fillStyle = "rgba(5, 14, 7, 0.9)";
      bCtx.fillRect(0, 0, 512, 320);

      bCtx.strokeStyle = "#fbbf24";
      bCtx.lineWidth = 12;
      bCtx.strokeRect(14, 14, 484, 292);

      bCtx.fillStyle = "#fbbf24";
      bCtx.font = "bold 82px 'Inter', sans-serif";
      bCtx.textAlign = "center";
      bCtx.textBaseline = "middle";
      bCtx.shadowColor = "#b45309";
      bCtx.shadowBlur = 28;
      bCtx.fillText("FINISH", 256, 160);

      const bannerTex = new THREE.CanvasTexture(bannerCanvas);
      bannerTex.generateMipmaps = false;
      bannerTex.minFilter = THREE.LinearFilter;

      const bannerPositions = [
        { x: centerX - roadW * 0.15, y: 2.6, ry: 0 },
        { x: centerX,                  y: 2.6, ry: Math.PI / 2 },
        { x: centerX + roadW * 0.15,  y: 2.6, ry: 0 }
      ];
      bannerPositions.forEach((bp, bi) => {
        const bgGeo = new THREE.PlaneGeometry(1.0, 2.6);
        const bgMat = new THREE.MeshBasicMaterial({
          map: bannerTex,
          transparent: true,
          depthWrite: false,
          fog: false
        });
        const banner = new THREE.Mesh(bgGeo, bgMat);
        banner.position.set(bp.x, bp.y, finishZ + (bi - 1) * 0.6);
        banner.rotation.y = bp.ry;
        addDerbyRoadVisual(banner);
      });
    }

    function buildThreeDRoadAndLanes(numLanes) {

      // Mặt đường nhựa xám đậm

      const roadW = getDerbyTrackWidth(numLanes);
      const laneSpacing = getDerbyLaneSpacing(numLanes);

      const { roadMinZ, roadMaxZ } = getDerbyRoadBounds();
      const roadLength = roadMaxZ - roadMinZ;
      const roadCenterZ = (roadMinZ + roadMaxZ) / 2;
      const roadCfg = getDerbyRoadConfig();
      derbyTrackDecorations = [];

      addDerbyBackdrop(roadW);
      derbyRoadVisualRoot = createDerbyRoadVisualRoot(roadW);

      const roadGeo = new THREE.PlaneGeometry(roadW, roadLength);

      const roadMat = new THREE.MeshStandardMaterial({

        color: "#051108",

        roughness: 0.8,

        metalness: 0.1

      });

      const road = new THREE.Mesh(roadGeo, roadMat);

      road.rotation.x = -Math.PI / 2;

      road.position.set(roadW / 2 - 1, 0, roadCenterZ);

      addDerbyRoadVisual(road);

      addDerbyStarField(roadW);
      addDerbyPlanetDecorations(roadW);
      addDerbyCustomObjects(roadW);

      

      // Làn ranh giới phát sáng

      for (let i = 0; i <= numLanes; i++) {

        const points = [];

        points.push(new THREE.Vector3(i * laneSpacing, 0.06, roadMinZ));

        points.push(new THREE.Vector3(i * laneSpacing, 0.06, roadMaxZ));

        

        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);

        const lineMat = new THREE.LineBasicMaterial({

          color: i === 0 || i === numLanes ? "#fbbf24" : "#10b981",

          opacity: derbyNumber(roadCfg.gridOpacity, 0.35),

          transparent: true

        });

        const line = new THREE.Line(lineGeo, lineMat);

        addDerbyRoadVisual(line);

      }

      

      // Vạch đích phát sáng

      const finishGeo = new THREE.BoxGeometry(roadW, 0.05, 0.5);

      const finishMat = new THREE.MeshStandardMaterial({

        color: "#fbbf24",

        emissive: "#b45309",

        roughness: 0.2

      });

      const finishLine = new THREE.Mesh(finishGeo, finishMat);

      finishLine.position.set(roadW / 2 - 1, 0.06, 10); // Vạch đích ở tọa độ Z = 10

      addDerbyRoadVisual(finishLine);

    }



    function createDerbyWolfModel(color) {
      const wolf = createBeastWolfModel(THREE, color, { name: "derby-wolf" });
      return wolf;
    }

    // Khởi tạo các cờ hiệu đấu sĩ 3D
    function initThreeDRacers(names) {
      threeRacers = [];
      clearDerbyRaceLabels();
      const labelOverlay = ensureDerbyLabelOverlay();

      const numRacers = names.length;

      

      names.forEach((name, i) => {

        const skin = MYTHICAL_BEAST_SKINS[i % MYTHICAL_BEAST_SKINS.length];

        

        // 1. Dựng linh thú sói 3D nhẹ, không cần file model ngoài.
        const group = new THREE.Group();
        const visualScale = Math.min(1, Math.max(0.65, derbyLaneSpacing / 1.1));
        group.scale.set(visualScale, visualScale, visualScale);
        
        const wolf = createDerbyWolfModel(skin.color);
        wolf.position.y = 0;
        group.add(wolf);
        
        // Vòng bảo vệ bên ngoài
        const ringGeo = new THREE.TorusGeometry(0.5, 0.05, 8, 24);
        const ringMat = new THREE.MeshStandardMaterial({

          color: "#fbbf24",

          roughness: 0.3

        });

        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.y = 0.35;
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        group.userData.wolf = wolf;
        group.userData.ring = ring;

        const motionBeacon = createDerbyHoverDisc(skin.color, 0.42);
        motionBeacon.position.set(0, 1.02, 0.18);
        motionBeacon.userData.baseScale = 0.42;
        group.add(motionBeacon);
        group.userData.motionBeacon = motionBeacon;
        

        // Bảng tên chạy bằng DOM overlay để không che model 3D.
        const nameLabel = createDerbyRaceLabel(name, skin.color);
        if (labelOverlay) labelOverlay.appendChild(nameLabel);



        // Tọa độ xuất phát
        const posX = i * derbyLaneSpacing + derbyLaneSpacing / 2;

        const posZ = trackLength; // Start ở Z = 120

        group.position.set(posX, 0, posZ);

        

        threeScene.add(group);

        

        // Tính vận tốc dựa vào chiều dài đường đua và thời gian đua cấu hình

        const duration = getDerbySelectedDurationSeconds();

        const totalFrames = duration * 60; // Giả sử chạy mượt 60fps

        const runDistance = trackLength - 10; // Điểm xuất phát (trackLength) về đích (10)

        const avgSpeed = runDistance / totalFrames;



        // Đưa vào mảng

        threeRacers.push({

          name: name,

          group: group,

          x: posX,

          startZ: posZ,

          rawZ: posZ,

          displayZ: posZ,

          z: posZ,

          speed: avgSpeed,

        plannedFinishMs: duration * 1000 * (0.92 + Math.random() * 0.08),

          timePenaltyMs: 0,

          timeBonusMs: 0,

          visualTimeOffsetMs: 0,

          timeOffsetUpdatedAt: performance.now(),

          boostTimer: 0,

          slowTimer: 0,

          finished: false,

          finishTime: 0,

          color: skin.color,

          emoji: skin.emoji,
          skinName: skin.name,
          skinIndex: i % MYTHICAL_BEAST_SKINS.length,
          skinElement: skin.element,

          rank: 0,

          laneIndex: i,

          labelEl: nameLabel,

          nameSprite: null,

          baseLabelScale: null,

          trailParticles: [] // Hệ thống vệt đuôi hạt

        });

      });

    }



    function createThreeDRacerNameplate(name, color, labelOffsetX = 0) {

      const canvas = document.createElement("canvas");

      canvas.width = 820;

      canvas.height = 240;

      const ctx = canvas.getContext("2d");

      ctx.clearRect(0, 0, canvas.width, canvas.height);



      ctx.shadowColor = "rgba(0,0,0,0.85)";

      ctx.shadowBlur = 18;

      ctx.fillStyle = "rgba(1, 8, 4, 0.94)";

      ctx.beginPath();

      ctx.roundRect(34, 24, 752, 132, 22);

      ctx.fill();

      ctx.shadowBlur = 0;



      ctx.strokeStyle = color;

      ctx.lineWidth = 8;

      ctx.stroke();



      ctx.fillStyle = "#ffffff";

      ctx.font = "900 92px 'Inter', sans-serif";

      ctx.textAlign = "center";

      ctx.textBaseline = "middle";

      ctx.lineWidth = 10;

      ctx.strokeStyle = "rgba(0,0,0,0.9)";

      ctx.strokeText(name, 410, 90, 700);

      ctx.fillText(name, 410, 90, 700);



      const arrowX = Math.max(90, Math.min(730, 410 - labelOffsetX * 165));

      ctx.fillStyle = color;

      ctx.beginPath();

      ctx.moveTo(arrowX - 30, 156);

      ctx.lineTo(arrowX + 30, 156);

      ctx.lineTo(arrowX, 224);

      ctx.closePath();

      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.85)";

      ctx.lineWidth = 4;

      ctx.stroke();



      const texture = new THREE.CanvasTexture(canvas);

      texture.generateMipmaps = false;

      texture.minFilter = THREE.LinearFilter;

      texture.magFilter = THREE.LinearFilter;

      texture.needsUpdate = true;



      const material = new THREE.SpriteMaterial({

        map: texture,

        transparent: true,

        depthTest: false,

        depthWrite: false,

        fog: false

      });

      const sprite = new THREE.Sprite(material);

      sprite.renderOrder = 20;

      return sprite;

    }



    // Vẽ nhãn văn bản 2D Canvas đẩy sang Texture 3D

    function createThreeDTextSprite(text, color) {

      const canvas = document.createElement("canvas");

      canvas.width = 384;

      canvas.height = 128;

      const ctx = canvas.getContext("2d");

      

      // Khung viền mờ

      ctx.fillStyle = "rgba(4, 15, 8, 0.75)";

      ctx.beginPath();

      ctx.roundRect(8, 8, 368, 112, 18);

      ctx.fill();

      ctx.strokeStyle = color;

      ctx.lineWidth = 5;

      ctx.stroke();

      

      // Chữ

      ctx.fillStyle = "#ffffff";

      ctx.font = "900 54px 'Inter', sans-serif";

      ctx.textAlign = "center";

      ctx.textBaseline = "middle";

      ctx.fillText(text, 192, 64, 340);

      

      const texture = new THREE.CanvasTexture(canvas);

      texture.generateMipmaps = false;

      texture.minFilter = THREE.LinearFilter;

      texture.magFilter = THREE.LinearFilter;

      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false });

      const sprite = new THREE.Sprite(material);

      sprite.renderOrder = 19;

      sprite.scale.set(3, 0.75, 1);

      return sprite;

    }



    function runThreeDCountdown() {

      const overlay = document.getElementById("countdown-overlay");

      const numEl = document.getElementById("countdown-number");

      overlay.style.display = "flex";

      

      let sec = 3;

      numEl.textContent = sec;

      numEl.classList.add("show");

      if (canPlayGameAudio()) playTickSound(440, 0.08);

      

      let timer = setInterval(() => {

        numEl.classList.remove("show");

        sec--;

        if (sec > 0) {

          setTimeout(() => {

            numEl.textContent = sec;

            numEl.classList.add("show");

            if (canPlayGameAudio()) playTickSound(440, 0.08);

          }, 50);

        } else if (sec === 0) {

          setTimeout(() => {

            numEl.textContent = "CHẠY!";

            numEl.classList.add("show");

            if (canPlayGameAudio()) playHornSound();

            updateCommentaryText("💥 Tiếng kèn hiệu lệnh vang dội! Cuộc đua bắt đầu, vận mệnh đang dẫn lối!");

          }, 50);

        } else {

          clearInterval(timer);

          overlay.style.display = "none";

          // Vào hoạt ảnh render vòng lặp

          startRaceTimer();

          animateThreeDDerby();

        }

      }, 1000);

    }



    // Tắt hiệu ứng chớp trắng toàn màn hình khi sét đánh.

    function triggerDerbyFlashEffect() {

      const flash = document.getElementById("flash-overlay");

      if (flash) flash.style.opacity = "0";

    }



    // Vòng lặp Render chính 3D

    function animateThreeDDerby() {

      if (!threeIsRunning) return;

      const frameNow = performance.now();

      updateRaceTimerDisplay();

      

      // 1. Tính toán chuyển động ngẫu nhiên các đấu sĩ

      let finishedCount = threeRacers.filter(r => r.finished).length;

      let allFinished = true;



      // Xử lý sét đánh ngẫu nhiên

      const lightningTargets = getDerbyLightningTargets(threeRacers);

      if (lightningTargets.length > 0 && Math.random() < 0.005) {

        triggerDerbyFlashEffect();

        playLightningSound();

        const struckRacer = lightningTargets[Math.floor(Math.random() * lightningTargets.length)];

        applyLightningPenalty(struckRacer);

        updateCommentaryText(`⚡ Bão sét đột kích! Giật điện làm tê liệt [${struckRacer.name}]!`);

          

        // Thêm hiệu ứng sét đánh đồ họa (jagged line)

        createVisualLightningBolt(struckRacer.group.position);


      }



      // Xử lý cổng tăng tốc

      if (Math.random() < 0.007) {

        const boostIdx = Math.floor(Math.random() * threeRacers.length);

        if (!threeRacers[boostIdx].finished && threeRacers[boostIdx].slowTimer === 0) {

          applyBoostBonus(threeRacers[boostIdx]);

          playBoostSound();

          updateCommentaryText(`✨ [${threeRacers[boostIdx].name}] vừa nhận linh khí, rẽ sóng bứt phá!`);

        }

      }



      threeRacers.forEach(racer => {

        if (!racer.finished) {

          allFinished = false;

          

          const progress = getRacerTimeProgress(racer, frameNow);

          if (racer.boostTimer > 0) racer.boostTimer--;

          if (racer.slowTimer > 0) racer.slowTimer--;

          racer.rawZ = racer.startZ - (racer.startZ - 10) * progress;

          

          // Giới hạn kịch đích Z = 10

          if (progress >= 1) {

            racer.rawZ = 10;

            racer.finished = true;

            finishedCount++;

            racer.rank = finishedCount;

            racer.finishTime = Date.now();
            racer.finishedAtMs = performance.now();
            assignDerbyFinishDestination(racer);

            playTickSound(700, 0.1);

            

            updateCommentaryText(`🏁 Thần thú của [${racer.name}] cán đích thành công ở hạng Top ${racer.rank}!`);

          }

        }

        racer.z = getDerbyLogicalZ(racer);

      });



      applyDerbyLeaderVisualCompression();



      threeRacers.forEach(racer => {

        

        // Cập nhật vị trí vật thể 3D

        if (racer.finished && racer.podiumSlot) {
          updateDerbyFinishedRacerPose(racer, frameNow);
        } else {
          racer.group.position.z = racer.z;
        }

        

        // Tạo nhấp nhô nhẹ cho sói/vòng, giữ bảng tên đứng yên để chữ không bị nhòe.
        const wolf = racer.group.userData.wolf;
        const ring = racer.group.userData.ring;
        const motionBeacon = racer.group.userData.motionBeacon;
        if (!racer.finished) {
          const bob = Math.abs(Math.sin(frameNow * 0.015)) * 0.12;
          if (wolf) {
            wolf.position.y = bob;
            wolf.rotation.z = Math.sin(frameNow * 0.018 + racer.laneIndex) * 0.045;
            if (wolf.userData.tail) {
              const tailBaseX = wolf.userData.tail.userData.baseRotation?.x ?? -0.48;
              wolf.userData.tail.rotation.x = tailBaseX + Math.sin(frameNow * 0.025 + racer.laneIndex) * 0.18;
            }
            if (wolf.userData.legs) {
              wolf.userData.legs.forEach((leg, idx) => {
                leg.rotation.x = Math.sin(frameNow * 0.035 + idx * Math.PI) * 0.28;
              });
            }
          }
          if (ring) {
            ring.position.y = 0.22 + bob * 0.35;
            ring.rotation.z += 0.03;
          }
          if (motionBeacon) {
            const pulse = 0.82 + Math.sin(frameNow * 0.019 + racer.laneIndex) * 0.1;
            motionBeacon.visible = true;
            motionBeacon.position.y = 1.02 + bob * 0.55;
            motionBeacon.rotation.y += racer.boostTimer > 0 ? 0.085 : 0.045;
            motionBeacon.scale.set(pulse, pulse, pulse);
            if (motionBeacon.userData.disc?.material) {
              motionBeacon.userData.disc.material.opacity = racer.boostTimer > 0 ? 0.78 : 0.44;
            }
            if (motionBeacon.userData.ring?.material) {
              motionBeacon.userData.ring.material.opacity = racer.boostTimer > 0 ? 0.72 : 0.46;
            }
          }
        } else if (!racer.podiumSlot) {
          if (wolf) {
            wolf.position.y = 0;
            wolf.rotation.z = 0;
          }
          if (ring) ring.position.y = 0.22;
          if (motionBeacon) motionBeacon.visible = false;
        }


        // Tạo vệt đuôi hạt 3D

        createVisualRacerTrail(racer);

      });



      // 2. Camera điều khiển thông minh bám cả nhóm, sau race thì chuyển sang bục vinh danh.

      if (!updateDerbyShowcaseCamera(frameNow)) {
        updateDerbyCameraFrame(getDerbyPackCameraFocusZ(), true);
      }
      updateDerbyNameplateScales();
      updateNameplateRenderOrders();
      animateDerbyTrackDecorations(frameNow);
      animateDerbySpaceDecorations(frameNow);



      // Xếp hạng ảo cập nhật realtime bảng xếp hạng sidebar

      const sorted = [...threeRacers].sort((a, b) => {
        return sortDerbyRacersByTrueProgress(a, b);

      });

      

      updateLeaderboardUI(sorted);
      updateDerbyRaceLabels(sorted);



      // Render cảnh (đảm bảo an toàn khi bấm quay lại sảnh)

      if (threeRenderer && threeScene && threeCamera) {

        threeRenderer.render(threeScene, threeCamera);

      }

      

      if (allFinished) {

        if (!derbyPostRaceMode) {
          stopRaceTimer(true);
          playVictorySound();
          startDerbyPostRaceShowcase(sorted);
        }
        threeLoopId = requestAnimationFrame(animateThreeDDerby);

      } else {

        threeLoopId = requestAnimationFrame(animateThreeDDerby);

      }

    }



    // Hiệu ứng tia sét bằng đồ họa 3D

    function createVisualLightningBolt(targetPos) {

      initSharedThreeResources();

      const points = [];

      const startX = targetPos.x + (Math.random() - 0.5) * 2;

      const startZ = targetPos.z;

      const startY = 16;

      

      points.push(new THREE.Vector3(startX, startY, startZ));

      // Tạo điểm zích zắc

      const segments = 5;

      for (let i = 1; i < segments; i++) {

        const ratio = i / segments;

        const py = startY - ratio * startY;

        const px = startX + (targetPos.x - startX) * ratio + (Math.random() - 0.5) * 1.2;

        const pz = startZ + (Math.random() - 0.5) * 0.5;

        points.push(new THREE.Vector3(px, py, pz));

      }

      points.push(new THREE.Vector3(targetPos.x, targetPos.y + 0.35, targetPos.z));

      

      const boltGeo = new THREE.BufferGeometry().setFromPoints(points);

      const boltMat = sharedMaterials.lightningBolt;

      const bolt = new THREE.Line(boltGeo, boltMat);

      threeScene.add(bolt);

      

      // Xóa tia sét sau 100ms

      setTimeout(() => {

        threeScene.remove(bolt);

        boltGeo.dispose();

      }, 100);

    }



    // Hệ thống vệt đuôi hạt 3D neon

    function createVisualRacerTrail(racer) {

      // Emit hạt đuôi mới

      if (Math.random() < 0.4 && !racer.finished) {

        initSharedThreeResources();

        const geo = sharedGeometries.trail;

        const mat = getCachedMaterial(racer.boostTimer > 0 ? "#fbbf24" : racer.color, 0.6);

        const mesh = new THREE.Mesh(geo, mat);

        // Đặt ở tọa độ đuôi sau

        mesh.position.set(

          racer.group.position.x + (Math.random() - 0.5) * 0.2,

          racer.group.position.y + 0.3 + (Math.random() - 0.5) * 0.2,

          racer.z + 0.4

        );

        threeScene.add(mesh);

        

        racer.trailParticles.push({

          mesh: mesh,

          life: 30, // sống 30 frame

          speedY: 0.01 + Math.random() * 0.01

        });

      }



      // Di chuyển và làm biến mất hạt cũ

      for (let i = racer.trailParticles.length - 1; i >= 0; i--) {

        const p = racer.trailParticles[i];

        p.mesh.position.y += p.speedY;

        p.mesh.position.z += 0.04; // bay lùi nhẹ

        p.life--;

        

        // Thu nhỏ dần

        const scale = p.life / 30;

        p.mesh.scale.set(scale, scale, scale);

        

        if (p.life <= 0) {

          threeScene.remove(p.mesh);

          racer.trailParticles.splice(i, 1);

        }

      }

    }



    function onThreeWindowResize() {

      if (!threeIsRunning) return;

      const container = document.getElementById("webgl-container");

      const width = container.clientWidth;

      const height = container.clientHeight;

      

      applyDerbySceneStyles();
      threeCamera.fov = derbyNumber(getDerbyCameraConfig().fov, 52);

      threeCamera.aspect = width / height;

      threeCamera.updateProjectionMatrix();

      

      threeRenderer.setSize(width, height);

    }



    function cleanupWebGLScene() {

      threeIsRunning = false;
      showDerbyShowcaseActions(false);
      derbyPostRaceMode = false;
      derbyShowcaseCameraState = null;
      derbyPodiumGroup = null;
      derbyPodiumSlots = [];
      derbyPodiumWinners = [];
      derbyPrizeCount = 3;


      window.removeEventListener('resize', onThreeWindowResize);

      

      if (threeLoopId) {

        cancelAnimationFrame(threeLoopId);

        threeLoopId = null;

      }


      clearDerbyRaceLabels();

      


      

      // Clean up Speed Derby particles

      if (threeScene && threeRacers.length > 0) {

        threeRacers.forEach(racer => {

          if (racer.trailParticles) {

            racer.trailParticles.forEach(p => {

              if (p && p.mesh) {

                threeScene.remove(p.mesh);

              }

            });

          }

          

          if (racer.group) {

            threeScene.remove(racer.group);

            racer.group.traverse(node => {

              if (node.geometry) node.geometry.dispose();

              if (node.material) {

                if (Array.isArray(node.material)) {

                  node.material.forEach(m => m.dispose());

                } else {

                  node.material.dispose();

                }

              }

            });

          }

        });

      }

      

      // Generic deep cleanup of all objects in scene

      if (threeScene) {

        while (threeScene.children.length > 0) {

          const obj = threeScene.children[0];

          threeScene.remove(obj);

          obj.traverse(node => {

            if (node.geometry) node.geometry.dispose();

            if (node.material) {

              if (Array.isArray(node.material)) {

                node.material.forEach(m => m.dispose());

              } else {

                node.material.dispose();

              }

            }

          });

        }

      }

      

      // Clear shared geometry and material caches
      derbyTrackDecorations = [];
      derbySpaceDecorations = [];
      derbyRoadVisualRoot = null;
      resetDerbyCameraLayer();

      for (let key in sharedGeometries) {

        if (sharedGeometries[key]) sharedGeometries[key].dispose();

      }

      for (let key in sharedMaterials) {

        if (sharedMaterials[key]) sharedMaterials[key].dispose();

      }

      for (let key in materialCache) {

        if (materialCache[key]) materialCache[key].dispose();

      }

      sharedGeometries = {};

      sharedMaterials = {};

      materialCache = {};

      

      if (threeRenderer) {

        try {

          threeRenderer.dispose();

        } catch(e) {

          console.warn("Lỗi giải phóng WebGLRenderer:", e);

        }

        threeRenderer = null;

      }

      

      threeScene = null;

      threeCamera = null;

      threeRacers = [];


    }



    // ─── ĐIỀU KHIỂN BẢNG XẾP HẠNG & KẾT QUẢ ĐUA (CORE LEADERBOARD) ───

    

    function updateCommentaryText(text) {

      document.getElementById("commentary-text").textContent = text;

    }



    function updateLeaderboardUI(sortedRacers) {

      const list = document.getElementById("leaderboard-list");

      list.innerHTML = "";

      

      // Cập nhật text số người hoàn thành

      const finished = sortedRacers.filter(r => r.finished).length;

      document.getElementById("racer-progress-title").textContent = `Hoàn thành: ${finished} / ${sortedRacers.length}`;



      sortedRacers.forEach((racer, index) => {

        const item = document.createElement("div");

        const extraClass = racer.leaderboardClass ? ` ${racer.leaderboardClass}` : "";

        item.className = `leaderboard-item rank-${index + 1}${extraClass}`;

        

        let progressPercent = 0;

        if (racer.finished) {

          progressPercent = 100;

        } else {

          // Tính % quãng đường dựa vào Z chạy từ 120 về 10

          progressPercent = Math.round(((trackLength - getDerbyLogicalZ(racer)) / (trackLength - 10)) * 100);
          if (!Number.isFinite(progressPercent)) progressPercent = 0;
          progressPercent = clampDerbyValue(progressPercent, 0, 100);

        }

        

        let statusTag = `${progressPercent}%`;

        if (racer.scoreLabel) statusTag = racer.scoreLabel;

        else if (racer.finished) statusTag = "🏁 ĐÍCH";

        else if (racer.boostTimer > 0) statusTag = "⚡ SPRINT";

        else if (racer.slowTimer > 0) statusTag = "❄️ CHẬM";

        

        item.innerHTML = `

          <div class="leaderboard-rank">${racer.displayRankLabel || index + 1}</div>

          <div class="leaderboard-name">${racer.emoji} ${racer.name}</div>

          <div class="leaderboard-progress">${statusTag}</div>

        `;

        list.appendChild(item);

      });

    }



    // ─── BÁO CÁO KẾT QUẢ VINH DANH (RESULTS & DISCORD) ───

    let currentWinnersList = [];



    function escapeHtml(value) {

      const htmlMap = {

        "&": "&amp;",

        "<": "&lt;",

        ">": "&gt;",

        '"': "&quot;",

        "'": "&#39;"

      };

      return String(value ?? "").replace(/[&<>"']/g, char => htmlMap[char]);

    }



    function getSelectedPrizeCount() {

      const select = document.getElementById("prize-count-select");

      const value = parseInt(select?.value || "3", 10);

      return Math.max(1, Math.min(5, Number.isFinite(value) ? value : 3));

    }



    function getResultMedal(rank) {

      if (rank === 1) return "🥇";

      if (rank === 2) return "🥈";

      if (rank === 3) return "🥉";

      return "🎁";

    }



    function getPodiumVisualOrder(count) {

      const podiumOrders = {

        1: [1],

        2: [2, 1],

        3: [2, 1, 3],

        4: [4, 2, 1, 3],

        5: [4, 2, 1, 3, 5]

      };

      return podiumOrders[count] || podiumOrders[5];

    }

    let resultsPodiumScene = null;
    let resultsPodiumCamera = null;
    let resultsPodiumRenderer = null;
    let resultsPodiumLoopId = null;
    let resultsPodiumModels = [];

    function disposeResultsPodiumObject(object) {
      if (!object) return;
      object.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((material) => {
            if (material.map) material.map.dispose();
            material.dispose();
          });
        }
      });
    }

    function stopResultsPodiumScene() {
      if (resultsPodiumLoopId) {
        cancelAnimationFrame(resultsPodiumLoopId);
        resultsPodiumLoopId = null;
      }
      window.removeEventListener("resize", resizeResultsPodiumScene);
      if (resultsPodiumScene) {
        while (resultsPodiumScene.children.length > 0) {
          const child = resultsPodiumScene.children[0];
          resultsPodiumScene.remove(child);
          disposeResultsPodiumObject(child);
        }
      }
      if (resultsPodiumRenderer) {
        try { resultsPodiumRenderer.dispose(); } catch (e) { console.warn("Lỗi giải phóng podium renderer:", e); }
      }
      resultsPodiumScene = null;
      resultsPodiumCamera = null;
      resultsPodiumRenderer = null;
      resultsPodiumModels = [];
    }

    function getResultsPodiumHeight(rank) {
      if (rank === 1) return 1.18;
      if (rank === 2) return 0.88;
      if (rank === 3) return 0.7;
      if (rank === 4) return 0.52;
      return 0.44;
    }

    function getResultsPodiumColor(rank) {
      if (rank === 1) return "#fbbf24";
      if (rank === 2) return "#cbd5e1";
      if (rank === 3) return "#d97706";
      if (rank === 4) return "#10b981";
      return "#38bdf8";
    }

    function createResultsRankPlane(rank) {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 180;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = rank === 1 ? "#381a04" : "#ffffff";
      ctx.font = "900 96px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 12;
      ctx.fillText(String(rank), 128, 92);
      const texture = new THREE.CanvasTexture(canvas);
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
      return new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.36), material);
    }

    function createResultsPodiumBlock(rank, height) {
      const color = getResultsPodiumColor(rank);
      const group = new THREE.Group();
      const width = rank === 1 ? 1.16 : 1.02;
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, 0.88),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: rank === 1 ? 0.28 : 0.12,
          metalness: rank <= 3 ? 0.42 : 0.18,
          roughness: 0.36
        })
      );
      block.position.y = height / 2;
      group.add(block);

      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.08, 0.06, 0.94),
        new THREE.MeshBasicMaterial({ color: "#fff7cc", transparent: true, opacity: rank === 1 ? 0.44 : 0.22 })
      );
      rim.position.y = height + 0.02;
      group.add(rim);

      const rankPlane = createResultsRankPlane(rank);
      rankPlane.position.set(0, Math.max(0.22, height * 0.54), 0.451);
      group.add(rankPlane);
      return group;
    }

    function createResultsPodiumCrown() {
      const crown = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: "#fbbf24",
        emissive: "#f59e0b",
        emissiveIntensity: 0.55,
        metalness: 0.7,
        roughness: 0.22
      });
      const base = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.025, 8, 28), mat);
      base.rotation.x = Math.PI / 2;
      crown.add(base);
      [-0.16, 0, 0.16].forEach((x, index) => {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(index === 1 ? 0.07 : 0.055, index === 1 ? 0.28 : 0.22, 4), mat);
        spike.position.set(x, 0.14, 0);
        spike.rotation.y = Math.PI / 4;
        crown.add(spike);
      });
      crown.position.set(0, 1.18, 0.03);
      return crown;
    }

    function renderResultsPodiumLabels(racers, visualOrder) {
      const labels = document.getElementById("results-podium-labels");
      if (!labels) return;
      labels.innerHTML = visualOrder.map((rank) => {
        const racer = racers[rank - 1];
        if (!racer) return "";
        const medal = getResultMedal(rank);
        return `
          <div class="results-podium-label rank-${rank}">
            <span>${medal} Top ${rank}</span>
            <span class="podium-label-name">${escapeHtml(racer.name || `Hạng ${rank}`)}</span>
          </div>
        `;
      }).join("");
    }

    function resizeResultsPodiumScene() {
      const stage = document.getElementById("results-podium-stage");
      if (!stage || !resultsPodiumRenderer || !resultsPodiumCamera) return;
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      resultsPodiumRenderer.setSize(width, height, false);
      resultsPodiumCamera.aspect = width / height;
      resultsPodiumCamera.updateProjectionMatrix();
    }

    function startResultsPodiumScene(racers, visualOrder) {
      const stage = document.getElementById("results-podium-stage");
      const canvas = document.getElementById("results-podium-canvas");
      if (!stage || !canvas || !window.THREE || !racers.length) return false;

      stopResultsPodiumScene();
      resultsPodiumScene = new THREE.Scene();
      resultsPodiumCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
      resultsPodiumRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      resultsPodiumRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      resultsPodiumRenderer.setClearColor(0x000000, 0);

      const ambient = new THREE.AmbientLight("#dfffea", 1.35);
      const key = new THREE.DirectionalLight("#fff2b8", 1.9);
      key.position.set(2.8, 4.2, 4.6);
      const fill = new THREE.PointLight("#10b981", 1.8, 9);
      fill.position.set(-2.8, 2.2, 3.4);
      resultsPodiumScene.add(ambient, key, fill);

      const count = visualOrder.length;
      const spacing = count <= 3 ? 1.45 : 1.12;
      const centerOffset = (count - 1) / 2;
      visualOrder.forEach((rank, index) => {
        const racer = racers[rank - 1];
        if (!racer) return;
        const x = (index - centerOffset) * spacing;
        const podiumHeight = getResultsPodiumHeight(rank);

        const block = createResultsPodiumBlock(rank, podiumHeight);
        block.position.set(x, 0, 0);
        resultsPodiumScene.add(block);

        const beastGroup = new THREE.Group();
        const wolf = createDerbyWolfModel(racer.color || "#10b981");
        wolf.rotation.y = Math.PI;
        beastGroup.add(wolf);
        const scale = rank === 1 ? 0.86 : rank <= 3 ? 0.68 : 0.56;
        beastGroup.scale.set(scale, scale, scale);
        beastGroup.position.set(x, podiumHeight + getBeastSurfaceOffset(wolf, 0.02) * scale, 0.02);
        beastGroup.userData.baseY = beastGroup.position.y;
        beastGroup.userData.rank = rank;
        beastGroup.userData.wolf = wolf;
        beastGroup.userData.awardIdleAction = wolf.userData.awardIdleAction || "stand";

        if (rank === 1) {
          const haloMat = new THREE.MeshBasicMaterial({
            color: "#fbbf24",
            transparent: true,
            opacity: 0.58,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          });
          const halo = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.025, 8, 54), haloMat);
          halo.rotation.x = Math.PI / 2;
          halo.position.y = 0.45;
          beastGroup.add(halo);
          beastGroup.userData.halo = halo;
          beastGroup.add(createResultsPodiumCrown());
        }

        resultsPodiumScene.add(beastGroup);
        resultsPodiumModels.push(beastGroup);
      });

      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(4.8, 64),
        new THREE.MeshBasicMaterial({ color: "#0b2a13", transparent: true, opacity: 0.34, depthWrite: false })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.02;
      resultsPodiumScene.add(ground);

      resultsPodiumCamera.position.set(0, count >= 4 ? 2.35 : 2.2, count >= 4 ? 5.9 : 5.25);
      resultsPodiumCamera.lookAt(0, 0.92, 0);
      resizeResultsPodiumScene();
      window.addEventListener("resize", resizeResultsPodiumScene);
      animateResultsPodiumScene();
      return true;
    }

    function animateResultsPodiumScene() {
      if (!resultsPodiumRenderer || !resultsPodiumScene || !resultsPodiumCamera) return;
      const now = performance.now();
      resultsPodiumModels.forEach((model, index) => {
        const rank = model.userData.rank || index + 1;
        model.position.y = model.userData.baseY;
        model.rotation.y = Math.sin(now * 0.0018 + index) * 0.045;
        const wolf = model.userData.wolf;
        updateBeastIdlePose(wolf, model.userData.awardIdleAction || "stand", now, {
          seed: index + rank * 0.7,
          neighborSide: index % 2 === 0 ? 1 : -1
        });
        if (model.userData.halo) model.userData.halo.rotation.z += 0.018;
      });
      resultsPodiumRenderer.render(resultsPodiumScene, resultsPodiumCamera);
      resultsPodiumLoopId = requestAnimationFrame(animateResultsPodiumScene);
    }

    function renderFallbackPodium(sortedRacers, count) {
      const container = document.getElementById("podium-container");
      if (!container) return;
      container.classList.remove("has-3d-stage");
      container.innerHTML = getPodiumVisualOrder(count).map((rank, index) => {
        const racer = sortedRacers[rank - 1];
        if (!racer) return "";
        const safeName = escapeHtml(racer.name || `Hạng ${rank}`);
        const safeEmoji = escapeHtml(racer.emoji || "🐶");
        const crown = rank === 1 ? `<span class="podium-crown">👑</span>` : "";
        return `
          <div class="podium-column rank-${rank}" data-rank="${rank}" style="animation-delay: ${index * 0.06}s">
            <div class="podium-avatar-label">
              <span class="podium-racer-emoji">${safeEmoji}</span>
              <span class="podium-name">${safeName}</span>
            </div>
            ${crown}
            <div class="podium-box"><span>${rank}</span></div>
          </div>
        `;
      }).join("");
    }



    function renderWinnerCelebration(winner) {

      const container = document.getElementById("winner-celebration");

      if (!container) return;

      if (!winner) {

        container.innerHTML = "";

        return;

      }

      const winnerName = escapeHtml(winner.name || "Thần thú vô danh");

      const winnerEmoji = escapeHtml(winner.emoji || "🐶");
      const winnerSkin = escapeHtml(winner.skinName || "Thần thú");

      container.innerHTML = `

        <div class="winner-copy">

          <div class="winner-subtitle">Quán quân đại chiến</div>

          <div class="winner-name">

            <span class="winner-emoji">${winnerEmoji}</span>

            <span class="winner-name-text">${winnerName}</span>

          </div>

          <div class="winner-subtitle" style="margin-top: 4px; color: #fbbf24;">${winnerSkin}</div>

        </div>

      `;

    }



    function renderDynamicPodium(sortedRacers, prizeCount) {

      const container = document.getElementById("podium-container");

      if (!container) return;
      stopResultsPodiumScene();

      const count = Math.min(prizeCount, 5, sortedRacers.length);

      if (count <= 0) {

        container.innerHTML = "";
        container.classList.remove("has-3d-stage");

        return;

      }

      const visualOrder = getPodiumVisualOrder(count);
      container.classList.add("has-3d-stage");
      container.innerHTML = `
        <div class="results-podium-stage" id="results-podium-stage" aria-hidden="true">
          <canvas class="results-podium-canvas" id="results-podium-canvas"></canvas>
          <div class="results-podium-labels" id="results-podium-labels"></div>
        </div>
      `;
      renderResultsPodiumLabels(sortedRacers, visualOrder);
      if (!startResultsPodiumScene(sortedRacers, visualOrder)) {
        renderFallbackPodium(sortedRacers, count);
      }

    }



    function displayVictoryResults(sortedRacers) {

      const racers = Array.isArray(sortedRacers) ? sortedRacers : [];

      currentWinnersList = racers;

      threeIsRunning = false;


      fallbackIsRunning = false;

      document.getElementById("countdown-overlay").style.display = "none";
      showDerbyShowcaseActions(false);

      stopRaceTimer(true);

      

      // Bật modal kết quả ở lớp cao nhất để không bị pháo hoa/canvas che.

      const overlay = document.getElementById("results-overlay");

      overlay.style.display = "flex";

      overlay.style.zIndex = "5000";

      const panel = overlay.querySelector(".results-panel");

      if (panel) panel.scrollTop = 0;

      

      const prizeCount = getSelectedPrizeCount();

      renderWinnerCelebration(racers[0]);

      renderDynamicPodium(racers, prizeCount);



      // Sinh danh sách các giải thưởng

      const otherList = document.getElementById("results-other-list");

      otherList.innerHTML = "";

      

      for (let i = 1; i <= prizeCount; i++) {

        const racer = racers[i - 1];

        if (!racer) break;

        

        const prizeText = document.getElementById(`prize-input-${i}`).value || `Giải ${i}`;

        const medal = getResultMedal(i);

        

        const row = document.createElement("div");

        row.className = "results-row";

        row.innerHTML = `

          <span>${medal} <strong>Hạng ${i}</strong>: <span class="name">${escapeHtml(racer.name)}</span></span>

          <span class="prize-text">${escapeHtml(prizeText)}</span>

        `;

        otherList.appendChild(row);

      }

      

      // Khởi chạy pháo hoa vinh danh

      startFireworksAnimation();

      requestAnimationFrame(() => {

        overlay.style.display = "flex";

        if (panel) panel.focus?.();

      });

    }



    // Sao chép kết quả Discord

    function copyDiscordResults() {

      if (currentWinnersList.length === 0) return;

      

      const prizeCount = getSelectedPrizeCount();
      const activeGameName = activeMinigameModule?.name || "Đua Thú";

      let text = `🏆 *** KẾT QUẢ ${activeGameName.toUpperCase()} - SỰ KIỆN QUAY SỐ BAN HỘI *** 🏆\n\n`;

      

      for (let i = 1; i <= prizeCount; i++) {

        const racer = currentWinnersList[i - 1];

        if (!racer) break;

        

        const prizeText = document.getElementById(`prize-input-${i}`).value || `Giải ${i}`;

        const medal = getResultMedal(i);

        

        text += `${medal} **Hạng ${i}**: **${racer.name}** [${racer.emoji}] (Phần thưởng: *${prizeText}*)\n`;

      }

      

      text += `\n✨ Chúc mừng các chiến binh đã chiến thắng minigame ma thuật!`;

      

      // Sao chép vào bộ nhớ đệm

      navigator.clipboard.writeText(text).then(() => {

        alert("Đã sao chép nội dung kết quả định dạng Discord vào clipboard!");

      }).catch(err => {

        alert("Lỗi sao chép tự động: " + err);

      });

    }

    // Sao chép kết quả Tower Climb

    function copyTowerResults() {

      if (currentWinnersList.length === 0) return;

      let text = `🏆 *** KẾT QUẢ LEO THÁP - TOWER CLIMB *** 🏆\n\n`;

      const prizeCount = getSelectedPrizeCount();
      const awardedRacers = currentWinnersList.slice(0, prizeCount);

      awardedRacers.forEach((racer, index) => {

        const medal = getResultMedal(index + 1);

        text += `${medal} Top ${index + 1}: ${racer.emoji} ${racer.name}\n`;

      });

      text += `\n🎮 Chúc mừng các chiến binh đã chinh phục đỉnh tháp!`;

      navigator.clipboard.writeText(text).then(() => {

        alert("✅ Đã sao chép kết quả Tower Climb vào clipboard!");

      }).catch(err => {

        alert("Lỗi sao chép: " + err);

      });

    }



    function closeResultsOverlay() {

      document.getElementById("results-overlay").style.display = "none";

      stopResultsPodiumScene();

      stopFireworksAnimation();

      exitArenaView();

    }



    function exitArenaView() {

      // Ẩn tower cinematic UI khi thoát
      const cinematicUi = document.getElementById('tower-cinematic-ui');
      if (cinematicUi) cinematicUi.style.display = 'none';

      threeIsRunning = false;


      fallbackIsRunning = false;



      if (threeLoopId) {

        cancelAnimationFrame(threeLoopId);

        threeLoopId = null;

      }


      if (fallbackLoopId) {

        cancelAnimationFrame(fallbackLoopId);

        fallbackLoopId = null;

      }

      cleanupActiveMinigameModule();



      document.getElementById("results-overlay").style.display = "none";

      document.getElementById("selector-overlay").style.display = "none";

      document.getElementById("countdown-overlay").style.display = "none";
      showDerbyShowcaseActions(false);

      document.getElementById("arena-sidebar").classList.remove("show-mobile");

      stopRaceTimer(false);

      stopFireworksAnimation();
      stopResultsPodiumScene();

      

      document.getElementById("arena-view").style.display = "none";

      document.getElementById("lobby-view").style.display = "flex";

      if (typeof mngMusicSetMode === "function") mngMusicSetMode("lobby");

      document.getElementById("leaderboard-list").innerHTML = "";

      document.getElementById("racer-progress-title").textContent = `Hoàn thành: 0 / ${MAX_RACERS}`;

      updateCommentaryText("Trận đấu chuẩn bị bắt đầu! Các thần thú đang ở vạch xuất phát...");



      setTimeout(() => {

        cleanupWebGLScene();

        const fallbackCanvas = document.getElementById("fallback-canvas");

        const webglCanvas = document.getElementById("webgl-canvas");

        if (fallbackCanvas) fallbackCanvas.style.display = "none";

        if (webglCanvas) webglCanvas.style.display = "block";

      }, 0);

    }





    // ─── PHÁO HOA ĂN MỪNG TRÊN CANVAS (FIREWORKS ENGINE) ───

    let fwCanvas, fwCtx, fwLoopId;

    let fwParticles = [];

    let fwIsRunning = false;
    const FIREWORKS_SAFE_PADDING = 18;



    function startFireworksAnimation() {

      fwCanvas = document.getElementById("fireworks-canvas");

      if (!fwCanvas) return;

      fwCtx = fwCanvas.getContext("2d");

      fwCanvas.width = window.innerWidth;

      fwCanvas.height = window.innerHeight;

      fwCanvas.style.display = "block";

      fwCanvas.classList.add("celebration-active");

      document.getElementById("results-overlay")?.classList.add("fireworks-visible");

      

      fwIsRunning = true;

      fwParticles = [];

      

      window.addEventListener('resize', resizeFireworksCanvas);

      animateFireworks();

    }



    function stopFireworksAnimation() {

      fwIsRunning = false;

      document.getElementById("results-overlay")?.classList.remove("fireworks-visible");

      window.removeEventListener('resize', resizeFireworksCanvas);

      if (fwLoopId) {

        cancelAnimationFrame(fwLoopId);

        fwLoopId = null;

      }

      if (fwCtx && fwCanvas) {

        fwCtx.clearRect(0, 0, fwCanvas.width, fwCanvas.height);

        fwCanvas.style.display = "none";

        fwCanvas.classList.remove("celebration-active");

      }

    }



    function resizeFireworksCanvas() {

      fwCanvas.width = window.innerWidth;

      fwCanvas.height = window.innerHeight;

    }

    function getFireworksSafeRects() {
      if (!fwCanvas) return [];
      const selectors = [".results-panel", "#results-other-list"];
      return selectors
        .map((selector) => document.querySelector(selector))
        .filter(Boolean)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: Math.max(0, rect.left - FIREWORKS_SAFE_PADDING),
            top: Math.max(0, rect.top - FIREWORKS_SAFE_PADDING),
            right: Math.min(fwCanvas.width, rect.right + FIREWORKS_SAFE_PADDING),
            bottom: Math.min(fwCanvas.height, rect.bottom + FIREWORKS_SAFE_PADDING)
          };
        });
    }

    function isPointInFireworksSafeRect(x, y, safeRects) {
      return safeRects.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
    }

    function clearFireworksSafeRects(safeRects) {
      safeRects.forEach((rect) => {
        fwCtx.clearRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
      });
    }

    function createFireworkBurst(celebrationMode, safeRects) {
      const width = fwCanvas.width;
      const height = fwCanvas.height;
      let startX = width * 0.18;
      let targetY = height * 0.24;

      for (let attempt = 0; attempt < 18; attempt++) {
        const sideLeft = Math.random() < 0.5;
        startX = width * (sideLeft ? (0.07 + Math.random() * 0.23) : (0.7 + Math.random() * 0.23));
        targetY = height * (celebrationMode ? (0.08 + Math.random() * 0.34) : (0.12 + Math.random() * 0.4));
        if (!isPointInFireworksSafeRect(startX, targetY, safeRects)) break;
      }

      return {
        x: startX,
        y: height,
        tx: startX,
        ty: targetY,
        color: `hsl(${Math.random() * 360}, 95%, ${celebrationMode ? 66 : 60}%)`,
        exploded: false,
        speed: (celebrationMode ? 7.2 : 7) + Math.random() * (celebrationMode ? 2.8 : 3.2),
        life: 0
      };
    }



    function animateFireworks() {

      if (!fwIsRunning) return;

      

      const celebrationMode = document.getElementById("results-overlay")?.classList.contains("fireworks-visible");
      const safeRects = celebrationMode ? getFireworksSafeRects() : [];

      fwCtx.fillStyle = celebrationMode ? 'rgba(1, 6, 3, 0.13)' : 'rgba(3, 12, 5, 0.2)';

      fwCtx.fillRect(0, 0, fwCanvas.width, fwCanvas.height);

      

      // Bắn pháo hoa mới ngẫu nhiên

      if (Math.random() < (celebrationMode ? 0.025 : 0.025) && fwParticles.length < (celebrationMode ? 10 : 14)) {

        fwParticles.push(createFireworkBurst(celebrationMode, safeRects));

      }



      // Cập nhật hạt pháo

      for (let i = fwParticles.length - 1; i >= 0; i--) {

        const p = fwParticles[i];

        if (!p.exploded) {

          p.y -= p.speed;

          

          // Vẽ tia lửa bay lên

          if (!isPointInFireworksSafeRect(p.x, p.y, safeRects)) {
            fwCtx.fillStyle = p.color;

            fwCtx.beginPath();

            fwCtx.arc(p.x, p.y, celebrationMode ? 2.2 : 2, 0, Math.PI * 2);

            fwCtx.fill();
          }

          

          if (p.y <= p.ty) {

            p.exploded = true;

            // Tạo vụ nổ hạt

            const numSparks = (celebrationMode ? 28 : 22) + Math.floor(Math.random() * (celebrationMode ? 25 : 18));

            p.sparks = [];

            for (let j = 0; j < numSparks; j++) {

              const angle = Math.random() * Math.PI * 2;

              const speed = (celebrationMode ? 0.9 : 0.8) + Math.random() * (celebrationMode ? 3.4 : 3.1);

              p.sparks.push({

                x: p.x,

                y: p.y,

                vx: Math.cos(angle) * speed,

                vy: Math.sin(angle) * speed,

                alpha: celebrationMode ? 0.74 : 0.88,

                decay: (celebrationMode ? 0.018 : 0.02) + Math.random() * 0.016

              });

            }

            playTickSound(700, 0.06); // Tiếng pháo nổ nhẹ

          }

        } else {

          // Cập nhật hạt bụi nổ

          let deadSparks = 0;

          p.sparks.forEach(s => {

            s.x += s.vx;

            s.y += s.vy;

            s.vy += 0.08; // trọng lực rơi

            s.alpha -= s.decay;

            

            if (s.alpha <= 0) {

              deadSparks++;

            } else {

              if (!isPointInFireworksSafeRect(s.x, s.y, safeRects)) {
                fwCtx.fillStyle = p.color;

                fwCtx.globalAlpha = s.alpha;

                fwCtx.beginPath();

                fwCtx.arc(s.x, s.y, celebrationMode ? 1.35 : 1.25, 0, Math.PI * 2);

                fwCtx.fill();

                fwCtx.globalAlpha = 1.0;
              }

            }

          });

          

          if (deadSparks >= p.sparks.length) {

            fwParticles.splice(i, 1);

          }

        }

      }

      
      if (safeRects.length) clearFireworksSafeRects(safeRects);

      fwLoopId = requestAnimationFrame(animateFireworks);

    }





    // ─── KHỞI TẠO BẮT ĐẦU TRANG ───

    window.onload = function() {

      generatePrizeInputs();
      syncDerbyDurationControlFromConfig();

      updateNamesCount();

      

      // Setup game card click selection

      bindSelectableGameCard(1);
      bindSelectableGameCard(3);
      bindSelectableGameCard(4);

      syncRandomButtonState();
      syncDurationControlForSelectedGame();



      // Đồng bộ theme nếu có đổi từ index chính

      var savedTheme = localStorage.getItem('lg-theme') || 'dark';

      if (savedTheme === 'dark') {

        document.body.classList.add('theme-dark');

      } else {

        document.body.classList.remove('theme-dark');

      }

    };
    function exposeMinigameGlobals() {
      Object.assign(window, {
        updateNamesCount,
        syncRacerCheckState,
        addCheckedRacerToList,
        generatePrizeInputs,
        openSupabaseImportModal,
        closeSupabaseImportModal,
        showLockedRandomMessage,
        showLockedGameMessage,
        closeLockedAlertModal,
        triggerDirectStartGame,
        triggerRandomSelectionWheel,
        toggleMobileSidebar,
        toggleAudioMuted,
        copyDiscordResults,
        copyTowerResults,
        closeResultsOverlay,
        exitArenaView
      });

      window.__minigamesLegacyApi = {
        launchSpeedDerbyGame,
        cleanupWebGLScene,
        initThreeDScene,
        startFallback2DGame,
        loadThreeJSDynamic,
        updateCommentaryText,
        updateLeaderboardUI,
        displayVictoryResults,
        exitArenaView,
        resetRaceTimerDisplay,
        startRaceTimer,
        updateRaceTimerDisplay,
        stopRaceTimer,
        showPostGameActions,
        playTickSound,
        playHornSound,
        playBoostSound,
        playLightningSound,
        playVictorySound,
        initAudioContext,
        canPlayGameAudio,
        MYTHICAL_BEAST_SKINS,
        MAX_RACERS
      };
    }

    exposeMinigameGlobals();
