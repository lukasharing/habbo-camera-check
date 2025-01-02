// ----------------------------------------------------
// DOM Refs
// ----------------------------------------------------
const imageInput      = document.getElementById('imageInput');

const outputCanvas    = document.getElementById('outputCanvas');
const outputCtx       = outputCanvas.getContext('2d');

const bwCanvas        = document.getElementById('bwCanvas');
const bwCtx           = bwCanvas.getContext('2d');

const faceCanvas      = document.getElementById('faceCanvas');
const faceCtx         = faceCanvas.getContext('2d');

const isoCheckResult  = document.getElementById('isoCheckResult');
const faceCheckResult = document.getElementById('faceCheckResult');

const cameraContainer = document.getElementById('cameraContainer');
const dragBox         = document.getElementById('dragBox');

// This “face mask edges” image is used for the face overlap check
const faceMaskImg  = new Image();
faceMaskImg.src    = 'image/faceMask.jpg'; // or your path
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


function toBlackAndWhite(imageData, threshold = 1) {
    const { width, height, data } = imageData;
    const bwImageData = new ImageData(width, height);

    for (let i = 0; i < data.length; i += 4) {
        // Convert RGB to grayscale
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;

        // Apply threshold
        const value = gray >= threshold ? 255 : 0;

        // Set pixel to black or white
        bwImageData.data[i] = value;     // Red channel
        bwImageData.data[i + 1] = value; // Green channel
        bwImageData.data[i + 2] = value; // Blue channel
        bwImageData.data[i + 3] = 255;   // Alpha channel (fully opaque)
    }

    return bwImageData;
}

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
    const threshold = 99;
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

function getIndex(x, y, width) {
    return y * width + x;
}

function isBlack(x, y, data, width, height) {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const index = getIndex(x, y, width) * 4; // RGBA
    return data[index] === 0; // black => R=0
}

function isBlob(x, y, data, width, height){
    return isBlack(x + 1, y, data, width, height) && isBlack(x - 1, y, data, width, height) && isBlack(x, y + 1, data, width, height) && isBlack(x, y, data, width, height);
}

function findHorizontalLines(bwImageData, minLength) {
    const { width, height, data } = bwImageData;
    const lines = [];
  
    // For each row, find continuous runs of black pixels
    for (let y = 0; y < height; y++) {
      let x = 0;
      while (x < width) {
        if (isBlack(x, y, data, width, height)) {
          const startX = x;
          // Move forward until we find a non-black pixel
          while (x < width && isBlack(x, y, data, width, height)) {
            x++;
          }
          const endX = x - 1;
          const runLength = endX - startX + 1;
          if (runLength >= minLength) {
            // Build the segment as an array of points
            const segment = [];
            for (let col = startX; col <= endX; col++) {
              segment.push({ x: col, y });
            }
            lines.push(segment);
          }
        } else {
          x++;
        }
      }
    }
  
    return lines;
}
    
function findVerticalLines(bwImageData, minLength) {
    const { width, height, data } = bwImageData;
    const lines = [];
  
    // For each column, find continuous runs of black pixels
    for (let x = 0; x < width; x++) {
      let y = 0;
      while (y < height) {
        if (isBlack(x, y, data, width, height)) {
          const startY = y;
          // Move down until we find a non-black pixel
          while (y < height && isBlack(x, y, data, width, height)) {
            y++;
          }
          const endY = y - 1;
          const runLength = endY - startY + 1;
          if (runLength >= minLength) {
            // Build the segment as an array of points
            const segment = [];
            for (let row = startY; row <= endY; row++) {
              segment.push({ x, y: row });
            }
            lines.push(segment);
          }
        } else {
          y++;
        }
      }
    }
  
    return lines;
}

function findIsometricSegments(bwImageData, minLength) {
    const { width, height, data } = bwImageData;
  
    // Example directions for slopes: ±1, ±2, ±0.5
    // Add or remove directions as needed
    const isometricDirections = [
      // slope = ±1
      { dx:  1, dy:  1 },
      { dx:  1, dy: -1 },
      { dx: -1, dy:  1 },
      { dx: -1, dy: -1 },
  
      // slope = ±0.5 (2,1) or (2,-1), etc.
      { dx:  2, dy:  1 },
      { dx:  2, dy: -1 },
      { dx: -2, dy:  1 },
      { dx: -2, dy: -1 },
  
      // slope = ±2 (1,2) or (1,-2), etc.
      { dx:  1, dy:  2 },
      { dx:  1, dy: -2 },
      { dx: -1, dy:  2 },
      { dx: -1, dy: -2 }
    ];
  
    const allSegments = [];
  
    // For each direction, do a separate pass with a direction-specific visited
    for (const { dx, dy } of isometricDirections) {
      const visited = new Uint8Array(width * height);
  
      // Scan entire image
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (isBlack(x, y, data, width, height) && !visited[getIndex(x, y, width)]) {
            // "Start" pixel check => the previous pixel (x-dx, y-dy) must not be black
            const px = x - dx;
            const py = y - dy;
            if (isBlack(px, py, data, width, height)) {
              // This means we're in the middle of a line that was (or will be) traced
              continue;
            }
  
            // Trace forward
            const segment = [];
            let cx = x;
            let cy = y;
  
            while (isBlack(cx, cy, data, width, height) && !visited[getIndex(cx, cy, width)]) {
              segment.push({ x: cx, y: cy });
              visited[getIndex(cx, cy, width)] = 1;
  
              cx += dx;
              cy += dy;
            }
  
            if (segment.length >= minLength) {
              allSegments.push(segment);
            }
          }
        }
      }
    }
  
    return allSegments;
}
  
  


function findAllLineSegments(bwImageData) {
    const minLength = 4;
  
    // 1) Use run-based approach for horizontal/vertical:
    const horizontalSegments = findHorizontalLines(bwImageData, minLength);
    const verticalSegments   = findVerticalLines(bwImageData, minLength);
  
    // 2) Use direction-based approach for isometric lines (with negative directions, if desired)
    const isoSegments = findIsometricSegments(bwImageData, minLength); 

    // (Your existing diagonal scanning function or the one we wrote before)
    return {
      orthogonal: [
        ...horizontalSegments,
        ...verticalSegments
      ],
      isometric: isoSegments
    };
}
  
  
  

function highlightLinesInGreen(imageData, lines) {
    const { width, height, data } = imageData;

    // Helper: Modify a pixel to green
    function setPixelToGreen(x, y) {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const index = (y * width + x) * 4;
        data[index] = 0;      // Red channel
        data[index + 1] = 255; // Green channel
        data[index + 2] = 0;  // Blue channel
        data[index + 3] = 255; // Alpha channel (fully opaque)
    }

    // Highlight each line in green
    for (const line of lines) {
        for (const point of line) {
            setPixelToGreen(point.x, point.y);
        }
    }

    return imageData;
}
  

/**
 * 4) Face Check
 */
 function findFaceMatches(bwPixelData, faceMaskEdges) {
    const { width: userW, height: userH, data: userPixels } = bwPixelData;

    // Load face mask edges into a binary format
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = faceMaskEdges.width;
    maskCanvas.height = faceMaskEdges.height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.drawImage(faceMaskEdges, 0, 0);
    const maskData = maskCtx.getImageData(0, 0, faceMaskEdges.width, faceMaskEdges.height);
    const { width: maskW, height: maskH, data: maskPixels } = maskData;

    if (maskW > userW || maskH > userH) {
        console.warn('Face mask is larger than the image region - skipping face detection.');
        return [];
    }

    const matches = [];

    // Sliding window: Scan the user image for matching regions
    for (let yWin = 0; yWin <= userH - maskH; yWin++) {
        for (let xWin = 0; xWin <= userW - maskW; xWin++) {
            let match = true;

            // Compare the mask with the current window
            for (let my = 0; my < maskH; my++) {
                for (let mx = 0; mx < maskW; mx++) {
                    const maskIndex = (my * maskW + mx) * 4; // RGBA in mask
                    const userIndex = ((yWin + my) * userW + (xWin + mx)) * 4; // RGBA in user image

                    // Check if a black pixel in the mask exists as black in the user image
                    if (maskPixels[maskIndex] === 0 && userPixels[userIndex] !== 0) {
                        match = false;
                        break;
                    }
                }
                if (!match) break;
            }

            // If a match is found, save the bounding box
            if (match) {
                matches.push({ x: xWin, y: yWin, width: maskW, height: maskH });
            }
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
        // C) When user clicks "Process",
        //    we get the cropping area from the draggable box position
        const fixedWidth = 161;
        const fixedHeight = 117;
        const zoom      = 1;

        // read box offset
        boxX = parseInt(dragBox.style.left, 10) + 11;
        boxY = parseInt(dragBox.style.top, 10) + 21;

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


        const outData = outputCtx.getImageData(0, 0, outW, outH);
        const bwData   = toBlackAndWhite(outData);
        if(bwCanvas){
            bwCtx.putImageData(bwData, 0, 0);
        }

        // F) Face check
        if (!faceMaskLoaded) {
            faceCheckResult.textContent = 'Face mask still loading – skipping face check.';
            return;
        }

        const matches = findFaceMatches(bwData, faceMaskImg);

        faceCheckResult.textContent = matches.length === 0 ? 'No face found above threshold.' : `Found ${matches.length} face(s)`;

        // 1) Use 'findIsometricLines' to detect bigger lines
        const { isometric, orthogonal } = findAllLineSegments(bwData);
        console.log(isometric, orthogonal);
        
        // 2) Show how many lines we found
        if (isometric.length === 0) {
            isoCheckResult.textContent += `\nNo isometric lines >= 10px found.`;
        } else {
            isoCheckResult.textContent += `\nFound ${isometric.length} isometric line(s) >= 10px long.`;
        }
        
        // Render Debug!
        highlightLinesInGreen(bwData, isometric);
        bwCtx.putImageData(bwData, 0, 0);

        matches.forEach(m => {
            outputCtx.strokeStyle = 'lime';
            outputCtx.lineWidth   = 2;
            bwCtx.strokeRect(m.x, m.y, faceMaskImg.width, faceMaskImg.height);
        });

    } catch (err) {
        console.error(err);
        isoCheckResult.textContent = 'Error: ' + err.message;
    }
});
