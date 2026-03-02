(function () {
    'use strict';

    var canvas = document.getElementById('sortCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    var arr = [];
    var sorting = false;
    var steps = [];
    var stepIndex = 0;
    var animId = null;
    var comparisons = 0;
    var swaps = 0;

    var algorithmSelect = document.getElementById('algorithmSelect');
    var sizeSlider = document.getElementById('sizeSlider');
    var speedSlider = document.getElementById('speedSlider');
    var startBtn = document.getElementById('startBtn');
    var shuffleBtn = document.getElementById('shuffleBtn');
    var statusEl = document.getElementById('sortStatus');

    var BAR_COLOR = '#38bdf8';
    var COMPARE_COLOR = '#fbbf24';
    var SWAP_COLOR = '#f43f5e';
    var SORTED_COLOR = '#22c55e';
    var BG_COLOR = '#0a1628';

    function resizeCanvas() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function initArray() {
        var n = parseInt(sizeSlider.value, 10);
        arr = [];
        for (var i = 1; i <= n; i++) arr.push(i);
        shuffle(arr);
        comparisons = 0;
        swaps = 0;
    }

    function shuffle(a) {
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
    }

    function drawBars(highlights, sortedSet) {
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        var n = arr.length;
        var barW = canvas.width / n;
        var maxVal = n;

        for (var i = 0; i < n; i++) {
            var barH = (arr[i] / maxVal) * (canvas.height - 10);
            var x = i * barW;
            var y = canvas.height - barH;

            if (sortedSet && sortedSet.has(i)) {
                ctx.fillStyle = SORTED_COLOR;
            } else if (highlights && highlights.swap && (highlights.swap[0] === i || highlights.swap[1] === i)) {
                ctx.fillStyle = SWAP_COLOR;
            } else if (highlights && highlights.compare && (highlights.compare[0] === i || highlights.compare[1] === i)) {
                ctx.fillStyle = COMPARE_COLOR;
            } else {
                ctx.fillStyle = BAR_COLOR;
            }

            ctx.fillRect(x + 0.5, y, Math.max(barW - 1, 1), barH);
        }
    }

    function bubbleSortSteps(a) {
        var generated = [];
        var localArr = a.slice();
        var n = localArr.length;
        for (var i = 0; i < n - 1; i++) {
            for (var j = 0; j < n - i - 1; j++) {
                generated.push({ type: 'compare', indices: [j, j + 1], arr: localArr.slice() });
                if (localArr[j] > localArr[j + 1]) {
                    var t = localArr[j]; localArr[j] = localArr[j + 1]; localArr[j + 1] = t;
                    generated.push({ type: 'swap', indices: [j, j + 1], arr: localArr.slice() });
                }
            }
            generated.push({ type: 'sorted', index: n - i - 1, arr: localArr.slice() });
        }
        generated.push({ type: 'sorted', index: 0, arr: localArr.slice() });
        generated.push({ type: 'done', arr: localArr.slice() });
        return generated;
    }

    function insertionSortSteps(a) {
        var generated = [];
        var localArr = a.slice();
        var n = localArr.length;
        generated.push({ type: 'sorted', index: 0, arr: localArr.slice() });
        for (var i = 1; i < n; i++) {
            var j = i;
            while (j > 0) {
                generated.push({ type: 'compare', indices: [j - 1, j], arr: localArr.slice() });
                if (localArr[j - 1] > localArr[j]) {
                    var t = localArr[j]; localArr[j] = localArr[j - 1]; localArr[j - 1] = t;
                    generated.push({ type: 'swap', indices: [j - 1, j], arr: localArr.slice() });
                    j--;
                } else {
                    break;
                }
            }
            generated.push({ type: 'sorted', index: i, arr: localArr.slice() });
        }
        generated.push({ type: 'done', arr: localArr.slice() });
        return generated;
    }

    function selectionSortSteps(a) {
        var generated = [];
        var localArr = a.slice();
        var n = localArr.length;
        for (var i = 0; i < n - 1; i++) {
            var minIdx = i;
            for (var j = i + 1; j < n; j++) {
                generated.push({ type: 'compare', indices: [minIdx, j], arr: localArr.slice() });
                if (localArr[j] < localArr[minIdx]) minIdx = j;
            }
            if (minIdx !== i) {
                var t = localArr[i]; localArr[i] = localArr[minIdx]; localArr[minIdx] = t;
                generated.push({ type: 'swap', indices: [i, minIdx], arr: localArr.slice() });
            }
            generated.push({ type: 'sorted', index: i, arr: localArr.slice() });
        }
        generated.push({ type: 'sorted', index: n - 1, arr: localArr.slice() });
        generated.push({ type: 'done', arr: localArr.slice() });
        return generated;
    }

    function shellSortSteps(a) {
        var generated = [];
        var localArr = a.slice();
        var n = localArr.length;
        var gap = Math.floor(n / 2);
        while (gap > 0) {
            for (var i = gap; i < n; i++) {
                var j = i;
                while (j >= gap) {
                    generated.push({ type: 'compare', indices: [j - gap, j], arr: localArr.slice() });
                    if (localArr[j - gap] > localArr[j]) {
                        var t = localArr[j]; localArr[j] = localArr[j - gap]; localArr[j - gap] = t;
                        generated.push({ type: 'swap', indices: [j - gap, j], arr: localArr.slice() });
                        j -= gap;
                    } else {
                        break;
                    }
                }
            }
            gap = Math.floor(gap / 2);
        }
        for (var k = 0; k < n; k++) generated.push({ type: 'sorted', index: k, arr: localArr.slice() });
        generated.push({ type: 'done', arr: localArr.slice() });
        return generated;
    }

    function mergeSortSteps(a) {
        var generated = [];
        var localArr = a.slice();

        function mergeSort(lo, hi) {
            if (hi - lo <= 1) return;
            var mid = Math.floor((lo + hi) / 2);
            mergeSort(lo, mid);
            mergeSort(mid, hi);
            merge(lo, mid, hi);
        }

        function merge(lo, mid, hi) {
            var temp = [];
            var i = lo;
            var j = mid;
            while (i < mid && j < hi) {
                generated.push({ type: 'compare', indices: [i, j], arr: localArr.slice() });
                if (localArr[i] <= localArr[j]) temp.push(localArr[i++]);
                else temp.push(localArr[j++]);
            }
            while (i < mid) temp.push(localArr[i++]);
            while (j < hi) temp.push(localArr[j++]);
            for (var k = 0; k < temp.length; k++) {
                localArr[lo + k] = temp[k];
                generated.push({ type: 'swap', indices: [lo + k, lo + k], arr: localArr.slice() });
            }
        }

        mergeSort(0, localArr.length);
        for (var i = 0; i < localArr.length; i++) generated.push({ type: 'sorted', index: i, arr: localArr.slice() });
        generated.push({ type: 'done', arr: localArr.slice() });
        return generated;
    }

    function quickSortSteps(a) {
        var generated = [];
        var localArr = a.slice();

        function qs(lo, hi) {
            if (lo >= hi) {
                if (lo === hi) generated.push({ type: 'sorted', index: lo, arr: localArr.slice() });
                return;
            }

            var pivot = localArr[hi];
            var i = lo;
            for (var j = lo; j < hi; j++) {
                generated.push({ type: 'compare', indices: [j, hi], arr: localArr.slice() });
                if (localArr[j] < pivot) {
                    if (i !== j) {
                        var t = localArr[i]; localArr[i] = localArr[j]; localArr[j] = t;
                        generated.push({ type: 'swap', indices: [i, j], arr: localArr.slice() });
                    }
                    i++;
                }
            }

            if (i !== hi) {
                var t2 = localArr[i]; localArr[i] = localArr[hi]; localArr[hi] = t2;
                generated.push({ type: 'swap', indices: [i, hi], arr: localArr.slice() });
            }

            generated.push({ type: 'sorted', index: i, arr: localArr.slice() });
            qs(lo, i - 1);
            qs(i + 1, hi);
        }

        qs(0, localArr.length - 1);
        generated.push({ type: 'done', arr: localArr.slice() });
        return generated;
    }

    var sortedIndices = new Set();

    function getDelay() {
        var speed = parseInt(speedSlider.value, 10);
        return Math.max(1, Math.round(200 / speed));
    }

    function animate() {
        if (stepIndex >= steps.length) {
            sorting = false;
            startBtn.classList.remove('active');
            startBtn.textContent = 'Sort';
            statusEl.textContent = 'Done - ' + comparisons + ' comparisons, ' + swaps + ' swaps';
            arr = steps[steps.length - 1].arr.slice();
            var allSorted = new Set();
            for (var i = 0; i < arr.length; i++) allSorted.add(i);
            drawBars(null, allSorted);
            return;
        }

        var step = steps[stepIndex];
        arr = step.arr.slice();
        var highlights = {};
        if (step.type === 'compare') {
            highlights.compare = step.indices;
            comparisons++;
        } else if (step.type === 'swap') {
            highlights.swap = step.indices;
            swaps++;
        } else if (step.type === 'sorted') {
            sortedIndices.add(step.index);
        }

        drawBars(highlights, sortedIndices);
        statusEl.textContent = algorithmSelect.options[algorithmSelect.selectedIndex].text + ' - ' + comparisons + ' cmp, ' + swaps + ' swaps';

        stepIndex++;
        animId = setTimeout(animate, getDelay());
    }

    function startSort() {
        if (sorting) {
            sorting = false;
            clearTimeout(animId);
            startBtn.classList.remove('active');
            startBtn.textContent = 'Sort';
            statusEl.textContent = 'Paused';
            return;
        }

        sorting = true;
        startBtn.classList.add('active');
        startBtn.textContent = 'Pause';
        comparisons = 0;
        swaps = 0;
        sortedIndices = new Set();
        stepIndex = 0;

        var algo = algorithmSelect.value;
        if (algo === 'bubble') steps = bubbleSortSteps(arr);
        else if (algo === 'insertion') steps = insertionSortSteps(arr);
        else if (algo === 'selection') steps = selectionSortSteps(arr);
        else if (algo === 'shell') steps = shellSortSteps(arr);
        else if (algo === 'merge') steps = mergeSortSteps(arr);
        else if (algo === 'quick') steps = quickSortSteps(arr);

        animate();
    }

    function doShuffle() {
        if (sorting) {
            sorting = false;
            clearTimeout(animId);
            startBtn.classList.remove('active');
            startBtn.textContent = 'Sort';
        }

        initArray();
        sortedIndices = new Set();
        drawBars(null, null);
        statusEl.textContent = 'Shuffled - ' + arr.length + ' elements';
    }

    startBtn.addEventListener('click', startSort);
    shuffleBtn.addEventListener('click', doShuffle);
    sizeSlider.addEventListener('input', doShuffle);

    initArray();
    drawBars(null, null);
    statusEl.textContent = 'Ready - ' + arr.length + ' elements';
})();