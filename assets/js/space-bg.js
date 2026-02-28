/* ============================================================
   Space Background — Animated Canvas
   Earth with equirectangular texture maps, detailed sun
   with surface granulation, spectrally-tinted stars, and
   a satellite in geostationary orbit.
   ============================================================ */
(function () {
    'use strict';

    var canvas = document.getElementById('spaceCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W, H, dpr;
    var time = 0;
    var stars = [];
    var STAR_COUNT = 350;

    /* ---- Frame timing ---- */
    var frameTimes = [];
    var frameTimingInterval = 2000; /* log every 2 seconds */
    var lastTimingLog = performance.now();

    /* ---- Helpers ---- */
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function smoothstep(e0, e1, x) {
        var t = clamp((x - e0) / (e1 - e0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    /* ---- Resize ---- */
    function resize() {
        dpr = window.devicePixelRatio || 1;
        W = canvas.parentElement.offsetWidth;
        H = canvas.parentElement.offsetHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();
    /* initial earth disc sizing happens after first resize sets W, H, dpr */

    /* ============================================================
       TEXTURE LOADING — equirectangular Earth maps (as Image objects)
       ============================================================ */
    var earthImages = {};
    var earthImgCount = 0;
    var texturesReady = false;

    function loadEarthImage(key, src) {
        var img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            earthImages[key] = img;
            earthImgCount++;
            if (earthImgCount >= 3) texturesReady = true; /* day+night+clouds minimum */
        };
        img.onerror = function () { /* texture missing — fallback */ };
        img.src = src;
    }
    loadEarthImage('day',    'assets/earth/day_8k.jpg');
    loadEarthImage('night',  'assets/earth/night_8k.jpg');
    loadEarthImage('clouds', 'assets/earth/clouds_8k.jpg');
    loadEarthImage('spec',   'assets/earth/specular_8k.jpg');

    /* ============================================================
       EARTH — WebGL offscreen sphere renderer
       ============================================================ */
    var glCanvas = document.createElement('canvas');
        var gl = glCanvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true })
            || glCanvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
    var glReady = false;
    var glProgram = null;
    var glTextures = {};
    var glUniforms = {};
    var EARTH_DISC = 512;
    var earthNeedsResize = true;

    function updateEarthDisc() {
        var eR = Math.min(W, H) * 0.85;
        var nativeSize = Math.round(eR * 2 * dpr);
        nativeSize = Math.min(nativeSize, 4096);
        if (nativeSize !== EARTH_DISC && nativeSize > 0) {
            EARTH_DISC = nativeSize;
            glCanvas.width = EARTH_DISC;
            glCanvas.height = EARTH_DISC;
            if (gl) gl.viewport(0, 0, EARTH_DISC, EARTH_DISC);
            earthNeedsResize = true;
        }
    }
    glCanvas.width = EARTH_DISC;
    glCanvas.height = EARTH_DISC;

    /* Normalized sun direction — light comes from behind the earth
       so the viewer sees partial night side with city lights */
    var sunDX = 0.40, sunDY = 0.45, sunDZ = -0.80;
    var sLen = Math.sqrt(sunDX * sunDX + sunDY * sunDY + sunDZ * sunDZ);
    sunDX /= sLen; sunDY /= sLen; sunDZ /= sLen;

    /* Initial rotation so Midwest US (~95°W) faces the viewer */
    var EARTH_INITIAL_ROT = -95 * Math.PI / 180;

    /* --- Shaders --- */
    var VERT_SRC = [
        'attribute vec2 aPos;',
        'varying vec2 vUV;',
        'void main() {',
        '    vUV = aPos * 0.5 + 0.5;',
        '    gl_Position = vec4(aPos, 0.0, 1.0);',
        '}'
    ].join('\n');

    var FRAG_SRC = [
        'precision highp float;',
        'varying vec2 vUV;',
        'uniform float uRotation;',
        'uniform float uCloudOff;',
        'uniform vec3 uSunDir;',
        'uniform sampler2D uDay;',
        'uniform sampler2D uNight;',
        'uniform sampler2D uClouds;',
        'uniform sampler2D uSpec;',
        'uniform float uHasSpec;',
        '',
        '#define PI 3.14159265359',
        '',
        'float smoothstep2(float e0, float e1, float x) {',
        '    float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);',
        '    return t * t * (3.0 - 2.0 * t);',
        '}',
        '',
        'void main() {',
        '    vec2 ndc = vUV * 2.0 - 1.0;',
        '    float dist2 = dot(ndc, ndc);',
        '    if (dist2 > 1.0) { discard; }',
        '    float edgeAA = 1.0 - smoothstep(0.994, 1.0, dist2);',
        '',
        '    float nz = sqrt(1.0 - dist2);',
        '    float nx = ndc.x;',
        '    float ny = ndc.y;',  /* +Y is up on screen, matching north-up texture */
        '',
        '    /* Rotate around Y for Earth spin */',
        '    float cosR = cos(uRotation), sinR = sin(uRotation);',
        '    float rx = nx * cosR + nz * sinR;',
        '    float rz = -nx * sinR + nz * cosR;',
        '',
        '    /* Lat / lon → UV */',
        '    float lat = asin(clamp(ny, -1.0, 1.0));',
        '    float lon = atan(rx, rz);',
        '    float u = (lon + PI) / (2.0 * PI);',
        '    float v = (PI * 0.5 - lat) / PI;',
        '    vec2 texUV = vec2(u, v);',
        '',
        '    /* Cloud UV with drift */',
        '    vec2 cloudUV = vec2(fract(u + uCloudOff), v);',
        '',
        '    /* Diffuse lighting */',
        '    float diff = nx * uSunDir.x + ny * uSunDir.y + nz * uSunDir.z;',
        '    float dayMix = smoothstep2(-0.08, 0.25, diff);',
        '',
        '    /* Sample textures */',
        '    vec3 dayCol = texture2D(uDay, texUV).rgb;',
        '    vec3 nightCol = texture2D(uNight, texUV).rgb * 1.3;',
        '    vec3 col = dayCol * dayMix + nightCol * (1.0 - dayMix);',
        '',
        '    /* Cloud overlay */',
        '    float cloudBrt = texture2D(uClouds, cloudUV).r;',
        '    float cloudA = cloudBrt * (0.55 * dayMix + 0.05);',
        '    col = col * (1.0 - cloudA) + vec3(0.922, 0.941, 0.980) * cloudA;',
        '',
        '    /* Specular on water */',
        '    if (uHasSpec > 0.5 && diff > 0.3) {',
        '        float specV = texture2D(uSpec, texUV).r;',
        '        float specI = pow(diff, 32.0) * specV * 0.5;',
        '        col = min(vec3(1.0), col + vec3(specI * 0.706, specI * 0.784, specI));',
        '    }',
        '',
        '    /* Limb darkening */',
        '    float limb = pow(nz, 0.3);',
        '    col *= limb;',
        '',
        '    /* Atmospheric scattering at the limb */',
        '    float atm = pow(1.0 - nz, 3.5) * 0.55;',
        '    col = col * (1.0 - atm) + vec3(0.275, 0.510, 1.0) * atm;',
        '',
        '    gl_FragColor = vec4(col, edgeAA);',
        '}'
    ].join('\n');

    function compileShader(src, type) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('[space-bg] Shader error:', gl.getShaderInfoLog(s));
            return null;
        }
        return s;
    }

    function initGL() {
        if (!gl) return;
        var vs = compileShader(VERT_SRC, gl.VERTEX_SHADER);
        var fs = compileShader(FRAG_SRC, gl.FRAGMENT_SHADER);
        if (!vs || !fs) return;

        glProgram = gl.createProgram();
        gl.attachShader(glProgram, vs);
        gl.attachShader(glProgram, fs);
        gl.linkProgram(glProgram);
        if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
            console.error('[space-bg] Program link error:', gl.getProgramInfoLog(glProgram));
            return;
        }
        gl.useProgram(glProgram);

        /* Full-screen quad: two triangles */
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        var aPos = gl.getAttribLocation(glProgram, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        /* Uniforms */
        glUniforms.rotation = gl.getUniformLocation(glProgram, 'uRotation');
        glUniforms.cloudOff = gl.getUniformLocation(glProgram, 'uCloudOff');
        glUniforms.sunDir   = gl.getUniformLocation(glProgram, 'uSunDir');
        glUniforms.hasSpec  = gl.getUniformLocation(glProgram, 'uHasSpec');

        /* Texture unit assignments */
        gl.uniform1i(gl.getUniformLocation(glProgram, 'uDay'),    0);
        gl.uniform1i(gl.getUniformLocation(glProgram, 'uNight'),  1);
        gl.uniform1i(gl.getUniformLocation(glProgram, 'uClouds'), 2);
        gl.uniform1i(gl.getUniformLocation(glProgram, 'uSpec'),   3);

        gl.clearColor(0, 0, 0, 0);
        gl.disable(gl.DEPTH_TEST);
        gl.viewport(0, 0, EARTH_DISC, EARTH_DISC);

        glReady = true;
    }
    initGL();

    function uploadTexture(unit, img) {
        if (!gl || !img) return null;
        var tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        return tex;
    }

    var glTexturesUploaded = false;
    function ensureGLTextures() {
        if (glTexturesUploaded || !texturesReady || !glReady) return;
        gl.useProgram(glProgram);
        glTextures.day    = uploadTexture(0, earthImages.day);
        glTextures.night  = uploadTexture(1, earthImages.night);
        glTextures.clouds = uploadTexture(2, earthImages.clouds);
        if (earthImages.spec) {
            glTextures.spec = uploadTexture(3, earthImages.spec);
            gl.uniform1f(glUniforms.hasSpec, 1.0);
        } else {
            gl.uniform1f(glUniforms.hasSpec, 0.0);
        }
        gl.uniform3f(glUniforms.sunDir, sunDX, sunDY, sunDZ);
        glTexturesUploaded = true;
    }

    function renderEarthGL(rotation) {
        if (!glReady || !glTexturesUploaded) return;
        gl.viewport(0, 0, EARTH_DISC, EARTH_DISC);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(glProgram);
        gl.uniform1f(glUniforms.rotation, rotation);
        gl.uniform1f(glUniforms.cloudOff, time * 0.0008);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /* Fallback procedural Earth (when WebGL unavailable or textures still loading) */
    function drawEarthFallback(ex, ey, eR) {
        ctx.save();
        var eg = ctx.createRadialGradient(ex - eR * 0.2, ey - eR * 0.25, eR * 0.1, ex, ey, eR);
        eg.addColorStop(0, '#4db8ff'); eg.addColorStop(0.25, '#1a73b5');
        eg.addColorStop(0.5, '#155e8f'); eg.addColorStop(0.75, '#0e3d5e');
        eg.addColorStop(1, '#081d30');
        ctx.beginPath(); ctx.arc(ex, ey, eR, 0, Math.PI * 2);
        ctx.fillStyle = eg; ctx.fill();
        var sg = ctx.createLinearGradient(ex - eR * 0.3, ey, ex + eR, ey);
        sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.6, 'rgba(0,0,0,0.25)');
        sg.addColorStop(1, 'rgba(0,0,0,0.7)');
        ctx.beginPath(); ctx.arc(ex, ey, eR, 0, Math.PI * 2);
        ctx.fillStyle = sg; ctx.fill();
        ctx.restore();
    }

    function drawAtmosphere(ex, ey, eR) {
        for (var ai = 4; ai >= 1; ai--) {
            var aR = eR + ai * 14;
            var ag = ctx.createRadialGradient(ex, ey, eR - 8, ex, ey, aR);
            var aA = (0.07 / ai).toFixed(4);
            ag.addColorStop(0, 'rgba(56,189,248,0)');
            ag.addColorStop(0.65, 'rgba(56,189,248,' + aA + ')');
            ag.addColorStop(1, 'rgba(56,189,248,0)');
            ctx.beginPath(); ctx.arc(ex, ey, aR, 0, Math.PI * 2);
            ctx.fillStyle = ag; ctx.fill();
        }
        /* Bright rim on sun-facing edge */
        ctx.save();
        ctx.beginPath(); ctx.arc(ex, ey, eR + 5, 0, Math.PI * 2); ctx.clip();
        var rg = ctx.createRadialGradient(ex + eR * 0.4, ey - eR * 0.75, eR * 0.4, ex, ey, eR + 6);
        rg.addColorStop(0, 'rgba(140,210,255,0.30)');
        rg.addColorStop(0.4, 'rgba(80,170,255,0.12)');
        rg.addColorStop(1, 'rgba(30,100,200,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(ex - eR - 20, ey - eR - 20, eR * 2 + 40, eR * 2 + 40);
        ctx.restore();

        /* Fresnel edge glow */
        var fg = ctx.createRadialGradient(ex, ey, eR - 2, ex, ey, eR + 3);
        fg.addColorStop(0, 'rgba(150,200,255,0)');
        fg.addColorStop(0.5, 'rgba(150,200,255,0.08)');
        fg.addColorStop(1, 'rgba(150,200,255,0)');
        ctx.beginPath(); ctx.arc(ex, ey, eR + 3, 0, Math.PI * 2);
        ctx.fillStyle = fg; ctx.fill();
    }

    function drawEarth(t) {
        var ex = W * 0.18, ey = H * 1.28;
        var eR = Math.min(W, H) * 0.85;

        /* Ensure WebGL canvas matches native resolution */
        updateEarthDisc();

        if (texturesReady && glReady) {
            ensureGLTextures();
            earthNeedsResize = false;
            var t0 = performance.now();
            renderEarthGL(-t * 0.04 + EARTH_INITIAL_ROT);
            var t1 = performance.now();
            if (frameTimes.length < 200) {
                console.debug('[space-bg] Earth GL render: ' + (t1 - t0).toFixed(1) + ' ms  (' + EARTH_DISC + 'x' + EARTH_DISC + ' px)');
            }
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(glCanvas, ex - eR, ey - eR, eR * 2, eR * 2);
            ctx.restore();
        } else {
            drawEarthFallback(ex, ey, eR);
        }
        drawAtmosphere(ex, ey, eR);
    }

    /* ============================================================
       STARS — with spectral tint (exaggerated red / blue shift)
       ============================================================ */
    function initStars() {
        stars = [];
        for (var i = 0; i < STAR_COUNT; i++) {
            var temp = (Math.random() - 0.5) * 2; /* –1 blue … +1 red */
            var tR, tG, tB;
            if (temp < 0) {
                /* Blue-shifted: blue-white */
                tR = 180 + (1 + temp) * 75;  /* 180–255 */
                tG = 200 + (1 + temp) * 55;  /* 200–255 */
                tB = 255;
            } else {
                /* Red-shifted: warm white to orange-red */
                tR = 255;
                tG = 255 - temp * 105;        /* 255–150 */
                tB = 255 - temp * 160;        /* 255–95  */
            }
            stars.push({
                x: Math.random(), y: Math.random(),
                r: Math.random() * 1.5 + 0.3,
                phase: Math.random() * Math.PI * 2,
                speed: 0.3 + Math.random() * 1.2,
                tR: tR | 0, tG: tG | 0, tB: tB | 0
            });
        }
    }
    initStars();

    function drawStars(t) {
        for (var i = 0; i < stars.length; i++) {
            var s = stars[i];
            var flicker = 0.50 + 0.50 * Math.sin(t * s.speed + s.phase);
            var alpha = flicker * 0.85;
            var sx = s.x * W, sy = s.y * H;
            ctx.beginPath(); ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + s.tR + ',' + s.tG + ',' + s.tB + ',' + alpha.toFixed(3) + ')';
            ctx.fill();
            if (s.r > 1.1) {
                ctx.beginPath(); ctx.arc(sx, sy, s.r * 2.8, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(' + s.tR + ',' + s.tG + ',' + s.tB + ',' + (alpha * 0.09).toFixed(3) + ')';
                ctx.fill();
            }
        }
    }

    /* ============================================================
       SUN — enhanced with surface granulation, sunspots, prominences
       ============================================================ */
    /* Simple value noise for sun surface texture */
    function hashN(n) { n = Math.sin(n) * 43758.5453; return n - Math.floor(n); }
    function vnoise(x, y) {
        var ix = Math.floor(x), iy = Math.floor(y);
        var fx = x - ix, fy = y - iy;
        fx = fx * fx * (3 - 2 * fx);
        fy = fy * fy * (3 - 2 * fy);
        var a = hashN(ix + iy * 57), b = hashN(ix + 1 + iy * 57);
        var c = hashN(ix + (iy + 1) * 57), d = hashN(ix + 1 + (iy + 1) * 57);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }

    /* Pre-render sun surface onto offscreen canvas */
    var sunCanvas = document.createElement('canvas');
    var sunCCtx = sunCanvas.getContext('2d');
    var SUN_TEX = 256;
    sunCanvas.width = SUN_TEX; sunCanvas.height = SUN_TEX;
    var sunTexReady = false;
    var sunFrameCount = 0;

    function renderSunTexture(t) {
        var S = SUN_TEX, R = S * 0.5;
        var img = sunCCtx.createImageData(S, S);
        var dd = img.data;
        for (var py = 0; py < S; py++) {
            for (var px = 0; px < S; px++) {
                var dx = (px - R) / R, dy = (py - R) / R;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 1) continue;

                /* Multi-octave noise → granulation */
                var sc = 4;
                var n = vnoise(dx * sc + t * 0.18, dy * sc + t * 0.14) * 0.50
                      + vnoise(dx * sc * 2.3 + t * 0.28, dy * sc * 2.3 - t * 0.09) * 0.30
                      + vnoise(dx * sc * 5.5 - t * 0.12, dy * sc * 5.5 + t * 0.18) * 0.20;

                /* Sunspots — subtle warm darkening */
                var sp1 = Math.max(0, 1 - Math.sqrt(Math.pow(dx - 0.15 - Math.sin(t * 0.05) * 0.1, 2) + Math.pow(dy + 0.2 - Math.cos(t * 0.04) * 0.08, 2)) / 0.13);
                var sp2 = Math.max(0, 1 - Math.sqrt(Math.pow(dx + 0.28 + Math.sin(t * 0.03) * 0.05, 2) + Math.pow(dy - 0.12 + Math.cos(t * 0.06) * 0.06, 2)) / 0.09);
                var spotDark = 1 - (sp1 * 0.22 + sp2 * 0.18);

                /* Very gentle limb darkening — edge stays hot white-yellow */
                var limbD = 0.65 + 0.35 * Math.pow(Math.max(0, 1 - dist * dist), 0.5);

                var r = 255, g = 250 + n * 5, b = 220 + n * 20;
                r *= spotDark * limbD;
                g *= spotDark * limbD;
                b *= spotDark * limbD * 0.95;

                var idx = (py * S + px) << 2;
                dd[idx]     = clamp(r, 0, 255) | 0;
                dd[idx + 1] = clamp(g, 0, 255) | 0;
                dd[idx + 2] = clamp(b, 0, 255) | 0;
                dd[idx + 3] = 255;
            }
        }
        sunCCtx.putImageData(img, 0, 0);
        sunTexReady = true;
    }

    function drawSun(t) {
        var sx = W * 0.82, sy = H * 0.12;
        var baseR = Math.min(W, H) * 0.019;
        ctx.beginPath();
        ctx.arc(sx, sy, baseR, 0, Math.PI * 2);
        ctx.fillStyle = '#fffee0';
        ctx.fill();
    }

    /* ============================================================
       SATELLITE — geostationary orbit with glowing orbit line
       ============================================================ */

    /* Orbit geometry (3D circle projected to screen) */
    var ORBIT_ALT   = 1.10;   /* orbital radius as fraction of earth radius */
    var ORBIT_INCL  = 0.00;   /* true geostationary: zero inclination (equatorial plane) */
    var ORBIT_TILT  = 0.00;   /* equatorial ring remains horizontal on screen */
    var ORBIT_SPEED = 0.04;
    var ORBIT_SEGS  = 300;
    /* Michigan ~85°W = 10° east of the 95°W earth-center.
       In orbit coords, east = theta increasing from -π/2, so: */
    var ORBIT_OFFSET = -Math.PI / 2 + 0.175;

    function orbitPoint(theta, ex, ey, orbR) {
        var cosTA = Math.cos(ORBIT_TILT), sinTA = Math.sin(ORBIT_TILT);
        var cosI  = Math.cos(ORBIT_INCL), sinI  = Math.sin(ORBIT_INCL);
        var cx    = orbR * Math.cos(theta);
        var cy3d  = orbR * Math.sin(theta);
        return {
            x: ex + cx * cosTA - cy3d * sinTA * cosI,
            y: ey + cx * sinTA + cy3d * cosTA * cosI,
            z: cy3d * sinI   /* positive = in front of earth */
        };
    }

    function orbitTangent(theta, orbR) {
        var cosTA = Math.cos(ORBIT_TILT), sinTA = Math.sin(ORBIT_TILT);
        var cosI  = Math.cos(ORBIT_INCL);
        var tx = -orbR * Math.sin(theta) * cosTA - orbR * Math.cos(theta) * sinTA * cosI;
        var ty = -orbR * Math.sin(theta) * sinTA + orbR * Math.cos(theta) * cosTA * cosI;
        return Math.atan2(ty, tx);
    }

    /* ---- Draw orbit line + satellite ---- */
    function drawOrbitAndSatellite(t) {
        var ex  = W * 0.18, ey = H * 1.28;
        var eR  = Math.min(W, H) * 0.85;
        var orbR = eR * ORBIT_ALT;

        var satTheta = t * ORBIT_SPEED + ORBIT_OFFSET;
        var satNorm  = ((satTheta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        var step     = (Math.PI * 2) / ORBIT_SEGS;

        /* --- Orbit glow (soft wide halo behind the line) --- */
        ctx.save();
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        for (var i = 0; i < ORBIT_SEGS; i++) {
            var th0 = i * step, th1 = (i + 1) * step;
            var pt0 = orbitPoint(th0, ex, ey, orbR);
            var pt1 = orbitPoint(th1, ex, ey, orbR);
            var avgZ = (pt0.z + pt1.z) * 0.5;
            var depthFade = 0.35 + 0.65 * smoothstep(-orbR * 0.5, orbR * 0.5, avgZ);
            var a = 0.045 * depthFade;
            ctx.beginPath(); ctx.moveTo(pt0.x, pt0.y); ctx.lineTo(pt1.x, pt1.y);
            ctx.strokeStyle = 'rgba(80,160,255,' + a.toFixed(4) + ')';
            ctx.stroke();
        }
        ctx.restore();

        /* --- Crisp orbit line --- */
        ctx.save();
        ctx.lineCap = 'round';
        for (var j = 0; j < ORBIT_SEGS; j++) {
            var a0 = j * step, a1 = (j + 1) * step;
            var q0 = orbitPoint(a0, ex, ey, orbR);
            var q1 = orbitPoint(a1, ex, ey, orbR);

            var az = (q0.z + q1.z) * 0.5;
            var df = 0.3 + 0.7 * smoothstep(-orbR * 0.5, orbR * 0.5, az);
            var baseA = (0.08 + 0.14 * df);

            var midA = (a0 + a1) * 0.5;
            var normMidA = ((midA % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            var angDist = Math.abs(normMidA - satNorm);
            if (angDist > Math.PI) angDist = Math.PI * 2 - angDist;
            var prox = Math.max(0, 1 - angDist / 0.6);
            baseA += prox * prox * 0.35;
            var lw = 0.7 + prox * 0.8;

            ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y);
            ctx.strokeStyle = 'rgba(120,190,255,' + clamp(baseA, 0, 1).toFixed(4) + ')';
            ctx.lineWidth = lw;
            ctx.stroke();
        }
        ctx.restore();

        /* --- Satellite — HUD pulsing dot --- */
        var satPt = orbitPoint(satTheta, ex, ey, orbR);
        var sx = satPt.x, sy = satPt.y;

        var depthAlpha = 0.5 + 0.5 * smoothstep(-orbR, orbR, satPt.z);
        var pulse = 0.55 + 0.45 * Math.sin(t * 1.8);
        var pulseOutward = (Math.sin(t * 1.8) * 0.5 + 0.5);

        var bloomR = 18;
        var bg = ctx.createRadialGradient(sx, sy, 0, sx, sy, bloomR);
        bg.addColorStop(0,   'rgba(80,200,255,' + (0.18 * pulse * depthAlpha).toFixed(4) + ')');
        bg.addColorStop(0.4, 'rgba(60,170,240,' + (0.08 * depthAlpha).toFixed(4) + ')');
        bg.addColorStop(1,   'rgba(30,120,200,0)');
        ctx.beginPath(); ctx.arc(sx, sy, bloomR, 0, Math.PI * 2);
        ctx.fillStyle = bg; ctx.fill();

        var ringR = 6 + pulseOutward * 12;
        var ringA = (1 - pulseOutward) * 0.5 * depthAlpha;
        if (ringA > 0.01) {
            ctx.beginPath(); ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(100,210,255,' + ringA.toFixed(4) + ')';
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }

        var coreR = 5;
        var ig = ctx.createRadialGradient(sx, sy, 0, sx, sy, coreR);
        ig.addColorStop(0,   'rgba(220,245,255,' + (0.95 * depthAlpha).toFixed(4) + ')');
        ig.addColorStop(0.35,'rgba(100,210,255,' + (0.70 * pulse * depthAlpha).toFixed(4) + ')');
        ig.addColorStop(1,   'rgba(40,150,230,0)');
        ctx.beginPath(); ctx.arc(sx, sy, coreR, 0, Math.PI * 2);
        ctx.fillStyle = ig; ctx.fill();

        ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(240,252,255,' + (0.95 * depthAlpha).toFixed(4) + ')';
        ctx.fill();

        ctx.save();
        ctx.strokeStyle = 'rgba(100,210,255,' + (0.55 * depthAlpha).toFixed(4) + ')';
        ctx.lineWidth = 0.8;
        var tk = 4, tg = 3.5;
        ctx.beginPath();
        ctx.moveTo(sx,         sy - tg - tk); ctx.lineTo(sx,         sy - tg);
        ctx.moveTo(sx,         sy + tg);      ctx.lineTo(sx,         sy + tg + tk);
        ctx.moveTo(sx - tg - tk, sy);         ctx.lineTo(sx - tg,    sy);
        ctx.moveTo(sx + tg,    sy);           ctx.lineTo(sx + tg + tk, sy);
        ctx.stroke();
        ctx.restore();
    }

    /* ============================================================
       HORIZON GLOW & NEBULA WISPS
       ============================================================ */
    function drawHorizonGlow(t) {
        var ex = W * 0.18, ey = H * 1.28;
        var eR = Math.min(W, H) * 0.85;
        var hg = ctx.createRadialGradient(ex, ey - eR * 0.95, 0, ex, ey - eR * 0.95, eR * 0.6);
        var pulse = 0.045 + 0.012 * Math.sin(t * 0.3);
        hg.addColorStop(0, 'rgba(56,189,248,' + pulse.toFixed(4) + ')');
        hg.addColorStop(0.5, 'rgba(30,100,200,' + (pulse * 0.3).toFixed(4) + ')');
        hg.addColorStop(1, 'rgba(10,22,40,0)');
        ctx.beginPath(); ctx.arc(ex, ey - eR * 0.95, eR * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = hg; ctx.fill();
    }

    function drawNebula(t) {
        ctx.save(); ctx.globalAlpha = 0.015;
        for (var n = 0; n < 3; n++) {
            var nx = W * (0.5 + 0.3 * Math.sin(0.01 * t + n * 2));
            var ny = H * (0.3 + 0.15 * Math.cos(0.008 * t + n * 1.5));
            var nr = Math.min(W, H) * (0.2 + n * 0.08);
            var ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
            ng.addColorStop(0, n % 2 === 0 ? 'rgba(60,80,180,1)' : 'rgba(100,50,150,1)');
            ng.addColorStop(1, 'transparent');
            ctx.beginPath(); ctx.arc(nx, ny, nr, 0, Math.PI * 2);
            ctx.fillStyle = ng; ctx.fill();
        }
        ctx.restore();
    }

    /* ============================================================
       MAIN RENDER LOOP
       ============================================================ */
    function frame() {
        var frameStart = performance.now();
        time += 0.016;

        ctx.fillStyle = '#050d1a';
        ctx.fillRect(0, 0, W, H);

        var vg = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.2, W * 0.5, H * 0.5, W * 0.9);
        vg.addColorStop(0, 'rgba(5,13,26,0)');
        vg.addColorStop(1, 'rgba(0,0,0,0.4)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

        drawNebula(time);
        drawStars(time);
        drawSun(time);
        drawHorizonGlow(time);
        drawEarth(time);
        drawOrbitAndSatellite(time);

        /* Frame timing */
        var frameEnd = performance.now();
        var elapsed = frameEnd - frameStart;
        frameTimes.push(elapsed);
        if (frameEnd - lastTimingLog >= frameTimingInterval) {
            var sum = 0, min = 1e9, max = 0;
            for (var i = 0; i < frameTimes.length; i++) {
                sum += frameTimes[i];
                if (frameTimes[i] < min) min = frameTimes[i];
                if (frameTimes[i] > max) max = frameTimes[i];
            }
            var avg = sum / frameTimes.length;
            var estFPS = 1000 / Math.max(avg, 0.01);
            console.log('[space-bg] Frames: ' + frameTimes.length +
                '  avg: ' + avg.toFixed(2) + ' ms' +
                '  min: ' + min.toFixed(2) + ' ms' +
                '  max: ' + max.toFixed(2) + ' ms' +
                '  est FPS: ' + estFPS.toFixed(0) +
                '  Earth: ' + EARTH_DISC + 'px');
            frameTimes = [];
            lastTimingLog = frameEnd;
        }

        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
})();
