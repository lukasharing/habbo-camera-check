// ----------------------------------------------------
// DOM Refs
// ----------------------------------------------------
const imageInput      = document.getElementById('imageInput');
const zoomInput       = document.getElementById('zoomInput');
const fixedSizeInput  = document.getElementById('fixedSize');

const outputCanvas    = document.getElementById('outputCanvas');
const outputCtx       = outputCanvas.getContext('2d');
const sobelCanvas     = document.getElementById('sobelCanvas');
const sobelCtx        = sobelCanvas.getContext('2d');
const sobelFaceCanvas = document.getElementById('sobelFace');

const isoCheckResult  = document.getElementById('isoCheckResult');
const faceCheckResult = document.getElementById('faceCheckResult');

const cameraContainer = document.getElementById('cameraContainer');
const dragBox         = document.getElementById('dragBox');

// This “face mask edges” image is used for the face overlap check
const faceMaskImg  = new Image();
faceMaskImg.src    = 'image/faceMaskEdges.jpg'; // or your path
let faceMaskLoaded = false;
faceMaskImg.onload = () => {
    faceMaskLoaded = true;
    console.log('Face mask loaded:', faceMaskImg.width, faceMaskImg.height);
};

// For tracking the user image once loaded
let userImg   = null;
let boxX      = 0;
let boxY      = 0;
let offsetX   = 0;
let offsetY   = 0;
let dragStart = false;

/**
 * 1) Utility: Load file as an Image
 */
function loadFileAsImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = evt => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = evt.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function getSobelDataPixelArt(imageData) {
    const { width, height, data } = imageData;

    // 1) Grayscale
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // 2) Sobel
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    const magArr = new Float32Array(width * height);
    const angArr = new Float32Array(width * height);

    function getGray(x, y) {
        x = Math.max(0, Math.min(x, width - 1));
        y = Math.max(0, Math.min(y, height - 1));
        return gray[y * width + x];
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let gx = 0, gy = 0, idx = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const val = getGray(x + dx, y + dy);
                    gx += val * sobelX[idx];
                    gy += val * sobelY[idx];
                    idx++;
                }
            }
            const mag = Math.sqrt(gx * gx + gy * gy);
            let angle = Math.atan2(gy, gx) * (180 / Math.PI);
            if (angle < 0) angle += 360;

            const pos = y * width + x;
            magArr[pos] = mag;
            angArr[pos] = angle;
        }
    }

    // 3) Normalize magnitudes
    let maxMag = 0;
    for (let i = 0; i < magArr.length; i++) {
        if (magArr[i] > maxMag) maxMag = magArr[i];
    }

    // 4) Binarize edge map for quick display
    const threshold = 8;
    const edgeData = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < magArr.length; i++) {
        let val = (magArr[i] / maxMag) * 255;
        val = val > threshold ? 255 : 0; 
        edgeData[i * 4 + 0] = val;
        edgeData[i * 4 + 1] = val;
        edgeData[i * 4 + 2] = val;
        edgeData[i * 4 + 3] = 255;
    }

    return {
        width,
        height,
        edgeMagnitudes: magArr,
        edgeAngles: angArr,
        edgeImage: edgeData
    };
}

/**
 * 3) Isometric check
 */
/**
 * findIsometricLines
 *  - magArr, angArr: from Sobel (same length = width*height)
 *  - width, height
 *  - magThreshold: minimum magnitude to consider “edge”
 *  - angleTolerance: ± around each isometric angle
 *  - minLineLen: how many consecutive pixels to be considered a line
 *
 * Returns an array of lines:
 *   Each line = { angle: 30 or 150 or 210 or 330, points: [ {x, y}, ... ] }
 */
 function findIsometricLines(
    magArr, angArr,
    width, height,
    magThreshold = 20,
    angleTolerance = 8,
    minLineLen = 10
  ) {
    const size = width * height;
    const visited = new Uint8Array(size); // 0 = not visited, 1 = visited
  
    // 1) Mark which pixels are "isometric edges"
    const isIsoEdge = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      if (magArr[i] > magThreshold) {
        const angle = angArr[i];
        if (isIsometricAngle(angle, angleTolerance)) {
          isIsoEdge[i] = 1; // yes, an isometric edge
        }
      }
    }
  
    const lines = [];
  
    // Helper to convert (x, y) <-> index
    function idxFromXY(x, y) {
      return y * width + x;
    }
    function xyFromIdx(i) {
      const y = Math.floor(i / width);
      const x = i % width;
      return {x, y};
    }
  
    // 2) We'll define discrete directions for 30,150,210,330
    //    Each direction has a dx, dy for integer steps.
    //    We choose the "closest" direction for each pixel's angle so that we only walk that way.
    //    Alternatively, you could do a BFS that allows slight angle variations.
    function closestIsometricAngle(angle) {
      // We pick whichever of [30,150,210,330] is closest
      const isoAngles = [30, 150, 210, 330];
      let best = isoAngles[0];
      let bestDiff = 9999;
      for (let iso of isoAngles) {
        let diff = Math.abs(iso - angle);
        if (diff > 180) diff = 360 - diff;
        if (diff < bestDiff) {
          bestDiff = diff;
          best = iso;
        }
      }
      return best;
    }
  
    // For each of the 4 angles, define (dx,dy)
    // - 30° = slope down-right => dx=1, dy=-1 if we consider "y down" as positive
    //   Actually, let's define them carefully:
    const directionMap = {
      30:  { dx: 1,  dy: -1 }, // up-right
      150: { dx: -1, dy: -1 }, // up-left
      210: { dx: -1, dy: 1  }, // down-left
      330: { dx: 1,  dy: 1  }  // down-right
    };
  
    // 3) Now we scan each pixel that is an isometric edge
    for (let i = 0; i < size; i++) {
      if (!isIsoEdge[i] || visited[i] === 1) {
        continue;
      }
      visited[i] = 1;
  
      // This pixel has an isometric angle => find which angle
      const angle = angArr[i];
      const mainAngle = closestIsometricAngle(angle);
  
      // We'll collect connected pixels going forward (dx, dy)
      // and also backward (-dx, -dy).
      const { x, y } = xyFromIdx(i);
      const { dx, dy } = directionMap[mainAngle];
  
      // forward chain
      const forward = traceLine(x, y, dx, dy);
      // backward chain
      const backward = traceLine(x, y, -dx, -dy);
  
      // Combine (excluding the current pixel from one side so we don’t double-count)
      // The final line is backward.reverse() + [currentPixel] + forward
      backward.pop(); // remove the repeated center pixel
      const points = backward.reverse().concat(forward);
  
      // Mark them visited
      for (const pt of points) {
        visited[idxFromXY(pt.x, pt.y)] = 1;
      }
  
      // If line is >= minLineLen => record it
      if (points.length >= minLineLen) {
        lines.push({
          angle: mainAngle,
          points
        });
      }
    }
  
    /**
     * traceLine: Starting from (sx, sy), move in (dx, dy) while
     *   - in bounds
     *   - isIsoEdge = 1
     *   - not visited
     */
    function traceLine(sx, sy, dx, dy) {
      const chain = [];
      let cx = sx, cy = sy;
  
      while (true) {
        // push
        chain.push({ x: cx, y: cy });
  
        // next
        let nx = cx + dx;
        let ny = cy + dy;
  
        // check bounds
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          break;
        }
        const nIdx = idxFromXY(nx, ny);
        if (!isIsoEdge[nIdx] || visited[nIdx] === 1) {
          break;
        }
  
        // continue
        visited[nIdx] = 1;
        cx = nx; cy = ny;
      }
      return chain;
    }
  
    return lines;
  }
  
  /**
   * Helper: true if 'angle' is within ±'tolerance' of any isometric angle [30,150,210,330].
   */
  function isIsometricAngle(angle, tolerance = 8) {
    const isoAngles = [30, 150, 210, 330];
    return isoAngles.some(a => {
      let diff = Math.abs(a - angle);
      if (diff > 180) diff = 360 - diff; // account for wraparound
      return diff <= tolerance;
    });
  }
  

/**
 * 4) Face Check
 */
async function findFaceMatches(userCanvas, faceMaskEdges, sobelFaceCanvas) {
    // 1) Sobel of userCanvas
    const userCtx   = userCanvas.getContext('2d');
    const userImage = userCtx.getImageData(0, 0, userCanvas.width, userCanvas.height);
    const userSobel = getSobelDataPixelArt(userImage);

    // 2) Load face mask edges from faceMaskEdges
    const off = document.createElement('canvas');
    off.width  = faceMaskEdges.width;
    off.height = faceMaskEdges.height;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(faceMaskEdges, 0, 0);
    const maskData = offCtx.getImageData(0, 0, faceMaskEdges.width, faceMaskEdges.height);

    // Optional display
    if (sobelFaceCanvas) {
        sobelFaceCanvas.width  = maskData.width;
        sobelFaceCanvas.height = maskData.height;
        const sobelFaceCtx = sobelFaceCanvas.getContext('2d');
        sobelFaceCtx.putImageData(maskData, 0, 0);
    }

    // Convert face mask edges to a Float32Array
    const maskMagArr = new Float32Array(maskData.width * maskData.height);
    for (let i = 0; i < maskMagArr.length; i++) {
        maskMagArr[i] = maskData.data[i * 4]; // only R needed, since it's grayscale
    }

    // 3) Overlap logic
    const userW = userCanvas.width, userH = userCanvas.height;
    const maskW = maskData.width,  maskH = maskData.height;
    if (maskW > userW || maskH > userH) {
        console.warn('Face mask is larger than the region - skipping face detection.');
        return [];
    }
    const userMagArr = userSobel.edgeMagnitudes;

    // Precompute sum of squares of mask
    let maskSumSq = 0;
    for (let i = 0; i < maskMagArr.length; i++) {
        maskSumSq += (maskMagArr[i] * maskMagArr[i]);
    }
    const eps = 1e-8;

    // Sliding window
    const matches = [];
    for (let yWin = 0; yWin <= userH - maskH; yWin++) {
        for (let xWin = 0; xWin <= userW - maskW; xWin++) {
            let dotProd = 0;
            let userSumSq = 0;

            for (let my = 0; my < maskH; my++) {
                for (let mx = 0; mx < maskW; mx++) {
                    const maskVal = maskMagArr[my * maskW + mx];
                    if (maskVal < 10) continue; // skip weak edges

                    const userPos = (yWin + my) * userW + (xWin + mx);
                    const userVal = userMagArr[userPos];
                    dotProd    += (maskVal * userVal);
                    userSumSq  += (userVal * userVal);
                }
            }
            const corr = dotProd / (Math.sqrt(maskSumSq + eps) * Math.sqrt(userSumSq + eps));
            matches.push({ x: xWin, y: yWin, correlation: corr });
        }
    }
    return matches;
}

function iou(boxA, boxB) {
    const xA = Math.max(boxA.x, boxB.x);
    const yA = Math.max(boxA.y, boxB.y);
    const xB = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
    const yB = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea  = boxA.width * boxA.height;
    const boxBArea  = boxB.width * boxB.height;
    return interArea / (boxAArea + boxBArea - interArea);
}

function nonMaxSuppression(detections, iouThreshold=0.3) {
    const final = [];
    detections.forEach(det => {
        let keep = true;
        for (const f of final) {
            if (iou(det, f) > iouThreshold) {
                keep = false;
                break;
            }
        }
        if (keep) final.push(det);
    });
    return final;
}

/**
 * 5) Draggable Box Logic
 *    - We start at (0,0). We'll clamp inside container on drag.
 */
 dragBox.style.left = '0px';
 dragBox.style.top  = '0px';
 
 // On mousedown, we store the offsets
 dragBox.addEventListener('mousedown', e => {
     dragStart = true;
 
     // Get the container's bounding rect once (relative to viewport).
     containerRect = cameraContainer.getBoundingClientRect();
 
     // “Where did we click inside the box?”
     // e.clientX is mouse X in viewport coords; subtract containerRect.left to get coords within container.
     // Then subtract dragBox.offsetLeft to get the difference from the box’s left side.
     offsetX = (e.clientX - containerRect.left) - dragBox.offsetLeft;
     offsetY = (e.clientY - containerRect.top)  - dragBox.offsetTop;
 
     e.preventDefault();
 });
 
 // On mousemove, update position if dragging
 document.addEventListener('mousemove', e => {
     if (!dragStart) return;
 
     // Current mouse position relative to container
     const mouseX = e.clientX - containerRect.left;
     const mouseY = e.clientY - containerRect.top;
 
     // The new top-left of the dragBox
     let newLeft = mouseX - offsetX;
     let newTop  = mouseY - offsetY;
 
     // Clamp to keep dragBox fully in container
     const maxLeft = containerRect.width  - dragBox.offsetWidth;
     const maxTop  = containerRect.height - dragBox.offsetHeight;
 
     newLeft = Math.max(0, Math.min(newLeft, maxLeft));
     newTop  = Math.max(0, Math.min(newTop,  maxTop));
 
     dragBox.style.left = `${newLeft}px`;
     dragBox.style.top  = `${newTop}px`;
 });
 
 // On mouseup, stop dragging
 document.addEventListener('mouseup', () => {
     dragStart = false;
 });

imageInput.addEventListener('change', async () => {
    const file = imageInput.files[0];
    if (!file) return;
    // A) Load user image if not yet loaded or changed
    userImg = await loadFileAsImage(file);

    // set container's background to this image
    cameraContainer.style.backgroundImage = `url('${userImg.src}')`;
    // set container size to match the image
    cameraContainer.style.width  = `${userImg.width}px`;
    cameraContainer.style.height = `${userImg.height}px`;

});

function highlightIsometricEdges(sobel, magThreshold = 20, angleTolerance = 8) {
    const { width, height, edgeMagnitudes, edgeAngles, edgeImage } = sobel;

    for (let i = 0; i < edgeMagnitudes.length; i++) {
        const mag = edgeMagnitudes[i];
        if (mag > magThreshold) {
            // If it's an isometric angle, color red
            const angle = edgeAngles[i];
            if (isIsometricAngle(angle, angleTolerance)) {
                edgeImage[i * 4 + 0] = 255; // R
                edgeImage[i * 4 + 1] = 0;   // G
                edgeImage[i * 4 + 2] = 0;   // B
                edgeImage[i * 4 + 3] = 255; // A
            }
        }
    }
}

/**
 * 6) Main 'Process' button
 */
document.getElementById('processBtn').addEventListener('click', async () => {
    isoCheckResult.textContent  = '';
    faceCheckResult.textContent = '';

    const file = imageInput.files[0];
    if (!file) {
        isoCheckResult.textContent = 'No image selected.';
        return;
    }

    try {

        // (Optional) reset the draggable box to top-left
        boxX = 0;
        boxY = 0;

        // C) When user clicks "Process",
        //    we get the cropping area from the draggable box position
        const fixedWidth = 322;
        const fixedHeight = 234;
        const zoom      = parseFloat(zoomInput.value);

        // read box offset
        boxX = parseInt(dragBox.style.left, 10);
        boxY = parseInt(dragBox.style.top, 10);

        // Prepare the output canvas
        const outW = fixedWidth * zoom;
        const outH = fixedHeight * zoom;
        outputCanvas.width  = outW;
        outputCanvas.height = outH;

        // D) Crop from userImg at (boxX, boxY), 
        //    scale to (outW, outH) in outputCanvas
        outputCtx.clearRect(0, 0, outW, outH);
        outputCtx.drawImage(
            userImg,
            boxX, boxY,
            fixedWidth, fixedHeight,
            0, 0,
            outW, outH
        );

        // E) Sobel Isometric check
        const outData = outputCtx.getImageData(0, 0, outW, outH);
        const sobel   = getSobelDataPixelArt(outData);

        sobelCanvas.width  = sobel.width;
        sobelCanvas.height = sobel.height;
        sobelCtx.putImageData(
            new ImageData(sobel.edgeImage, sobel.width, sobel.height),
            0, 0
        );

        const isoScore = getIsometricScore(
            sobel.edgeMagnitudes,
            sobel.edgeAngles,
            sobel.width,
            sobel.height,
            20
        );
        isoCheckResult.textContent = `Isometric Score: ${isoScore.toFixed(2)}% (>=10% is a likely pass)`;

        // 3) Now highlight isometric lines in red
        highlightIsometricEdges(sobel, 20 /* magThreshold */, 8 /* angleTolerance */);

        // 4) Re-draw the edge map with isometric lines in red
        sobelCtx.putImageData(
            new ImageData(sobel.edgeImage, sobel.width, sobel.height),
            0, 0
        );

        // F) Face check
        if (!faceMaskLoaded) {
            faceCheckResult.textContent = 'Face mask still loading – skipping face check.';
            return;
        }

        const matches = await findFaceMatches(outputCanvas, faceMaskImg, sobelFaceCanvas);
        const threshold = 0.97;
        const goodMatches = matches.filter(m => m.correlation > threshold);
        goodMatches.sort((a, b) => b.correlation - a.correlation);

        const boxes = goodMatches.map(m => ({
            x: m.x,
            y: m.y,
            width: faceMaskImg.width,
            height: faceMaskImg.height,
            correlation: m.correlation
        }));
        const finalBoxes = nonMaxSuppression(boxes, 0.5);

        if (finalBoxes.length === 0) {
            faceCheckResult.textContent = 'No face found above threshold.';
        } else {
            finalBoxes.forEach(m => {
                outputCtx.strokeStyle = 'lime';
                outputCtx.lineWidth   = 2;
                outputCtx.strokeRect(m.x, m.y, faceMaskImg.width, faceMaskImg.height);
            });
            faceCheckResult.textContent = `Found ${finalBoxes.length} face(s) with corr > ${threshold}`;
        }

    } catch (err) {
        console.error(err);
        isoCheckResult.textContent = 'Error: ' + err.message;
    }
});
