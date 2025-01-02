
 function loadImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = file;
    });
}

// ----------------------------------------------------
// DOM Refs
// ----------------------------------------------------
const imageInput = document.getElementById('imageInput');

const outputCanvas = document.getElementById('outputCanvas');
const outputCtx = outputCanvas.getContext('2d');

const bwCanvas = document.getElementById('bwCanvas');
const bwCtx = bwCanvas.getContext('2d');

const isoCheckResult = document.getElementById('isoCheckResult');
const faceCheckResult = document.getElementById('faceCheckResult');

const cameraContainer = document.getElementById('cameraContainer');
const dragBox = document.getElementById('dragBox');
const check = document.getElementById('check');


const case1 = document.getElementById('case1');
const case2 = document.getElementById('case2');


// Debounce Timer
let debounceTimer = null;

// This “face mask edges” image is used for the face overlap check
let faceMaskImg = undefined;

// For tracking the user image once loaded
let userImg = null;
let boxX = 0;
let boxY = 0;
let offsetX = 0;
let offsetY = 0;
let dragStart = false;


function toBlackAndWhite(imageData, threshold = 1) {
    const {
        width,
        height,
        data
    } = imageData;
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
        bwImageData.data[i] = value; // Red channel
        bwImageData.data[i + 1] = value; // Green channel
        bwImageData.data[i + 2] = value; // Blue channel
        bwImageData.data[i + 3] = 255; // Alpha channel (fully opaque)
    }

    return bwImageData;
}

/**
 * 1) Utility: Load file as an Image
 */
function loadFileAsImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async evt => {
            resolve(await loadImage(evt.target.result));
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function getSobelDataPixelArt(imageData) {
    const {
        width,
        height,
        data
    } = imageData;

    // 1) Grayscale
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i],
            g = data[i + 1],
            b = data[i + 2];
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
            let gx = 0,
                gy = 0,
                idx = 0;
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

function isBlob(x, y, data, width, height) {
    return isBlack(x + 1, y, data, width, height) && isBlack(x - 1, y, data, width, height) && isBlack(x, y + 1, data, width, height) && isBlack(x, y, data, width, height);
}

function getIndex(x, y, width) {
    return y * width + x;
}

function isBlack(x, y, data, width, height) {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const index = getIndex(x, y, width) * 4; // RGBA
    return data[index] === 0; // black => R=0
}

function isBlob(x, y, data, width, height) {
    return (
        isBlack(x + 1, y, data, width, height) &&
        isBlack(x - 1, y, data, width, height) &&
        isBlack(x, y + 1, data, width, height) &&
        isBlack(x, y - 1, data, width, height)
    );
}

function findHorizontalLines(bwImageData, minLength) {
    const {
        width,
        height,
        data
    } = bwImageData;
    const lines = [];

    // For each row, find continuous runs of black pixels
    for (let y = 0; y < height; y++) {
        let x = 0;
        while (x < width) {
            if (isBlack(x, y, data, width, height)) {
                const segment = [];

                // Start scanning the row for black pixels
                while (x < width && isBlack(x, y, data, width, height)) {
                    if (isBlob(x, y, data, width, height)) {
                        // Blob detected; terminate the segment before this pixel
                        break;
                    }
                    segment.push({
                        x,
                        y
                    });
                    x++;
                }

                const runLength = segment.length;
                if (runLength >= minLength) {
                    lines.push(segment);
                }

                // If a blob was detected, skip the blob pixel to avoid infinite loop
                if (isBlob(x, y, data, width, height)) {
                    x++; // Advance past the blob pixel
                }
            } else {
                x++;
            }
        }
    }

    return lines;
}

function findVerticalLines(bwImageData, minLength) {
    const {
        width,
        height,
        data
    } = bwImageData;
    const lines = [];

    // For each column, find continuous runs of black pixels
    for (let x = 0; x < width; x++) {
        let y = 0;
        while (y < height) {
            if (isBlack(x, y, data, width, height)) {
                const segment = [];

                // Start scanning the column for black pixels
                while (y < height && isBlack(x, y, data, width, height)) {
                    if (isBlob(x, y, data, width, height)) {
                        // Blob detected; terminate the segment before this pixel
                        break;
                    }
                    segment.push({
                        x,
                        y
                    });
                    y++;
                }

                const runLength = segment.length;
                if (runLength >= minLength) {
                    lines.push(segment);
                }

                // If a blob was detected, skip the blob pixel to avoid infinite loop
                if (isBlob(x, y, data, width, height)) {
                    y++; // Advance past the blob pixel
                }
            } else {
                y++;
            }
        }
    }

    return lines;
}

function findIsometricSegments(bwImageData, minLength) {
    const {
        width,
        height,
        data
    } = bwImageData;

    // Example directions for slopes: ±1, ±2, ±0.5
    // Ensure that dx and dy are never both zero
    const isometricDirections = [
        // slope = ±1
        {
            dx: 1,
            dy: 1
        },
        {
            dx: 1,
            dy: -1
        },
        {
            dx: -1,
            dy: 1
        },
        {
            dx: -1,
            dy: -1
        },

        // slope = ±0.5 (2,1) or (2,-1), etc.
        {
            dx: 2,
            dy: 1
        },
        {
            dx: 2,
            dy: -1
        },
        {
            dx: -2,
            dy: 1
        },
        {
            dx: -2,
            dy: -1
        },

        // slope = ±2 (1,2) or (1,-2), etc.
        {
            dx: 1,
            dy: 2
        },
        {
            dx: 1,
            dy: -2
        },
        {
            dx: -1,
            dy: 2
        },
        {
            dx: -1,
            dy: -2
        }
    ];

    const allSegments = [];

    // For each direction, do a separate pass with a direction-specific visited
    for (const {
            dx,
            dy
        }
        of isometricDirections) {
        // Prevent directions with both dx and dy as zero
        if (dx === 0 && dy === 0) continue;

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

                    // Initialize the segment
                    const segment = [];
                    let cx = x;
                    let cy = y;

                    while (
                        isBlack(cx, cy, data, width, height) &&
                        !visited[getIndex(cx, cy, width)]
                    ) {
                        // Check if the current pixel is a blob
                        if (isBlob(cx, cy, data, width, height)) {
                            // Blob detected; terminate the segment before adding this pixel
                            break;
                        }

                        // Add the current pixel to the segment
                        segment.push({
                            x: cx,
                            y: cy
                        });
                        visited[getIndex(cx, cy, width)] = 1;

                        // Move to the next pixel in the current direction
                        cx += dx;
                        cy += dy;

                        // Boundary check to prevent infinite loops
                        if (cx < 0 || cx >= width || cy < 0 || cy >= height) {
                            break;
                        }
                    }

                    if (segment.length >= minLength) {
                        allSegments.push(segment);
                    }

                    // If a blob was detected, ensure the next iteration skips it
                    if (
                        cx >= 0 &&
                        cx < width &&
                        cy >= 0 &&
                        cy < height &&
                        isBlob(cx, cy, data, width, height)
                    ) {
                        // Mark the blob pixel as visited to prevent reprocessing
                        visited[getIndex(cx, cy, width)] = 1;
                    }
                }
            }
        }
    }

    return allSegments;
}

function caculateCoverage(segment, width, height) {
    // Calculate coverage by isometric lines
    const coverageBitmap = new Uint8Array(width * height); // 0 = not covered, 1 = covered
    segment.forEach(line => {
        line.forEach(point => {
            coverageBitmap[getIndex(point.x, point.y, width)] = 1;
        });
    });

    // Count unique pixels
    return coverageBitmap.reduce((acc, p) => acc + (p === 1 ? 1 : 0), 0);
}

function findAllLineSegments(bwImageData) {
    const minLength = 4;
    const {
        width,
        height,
        data
    } = bwImageData;

    // Initialize structures to store line segments
    const horizontalSegments = findHorizontalLines(bwImageData, minLength);
    const verticalSegments = findVerticalLines(bwImageData, minLength);
    const isometricSegments = findIsometricSegments(bwImageData, minLength);

    // Calculate total black pixels in the image
    let totalBlacks = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 0) { // Check red channel for black
            totalBlacks++;
        }
    }

    let orthogonal = [
        ...horizontalSegments,
        ...verticalSegments
    ];

    return {
        orthogonal,
        isometric: isometricSegments,
        coverIsometric: caculateCoverage(isometricSegments, width, height), // Number of unique pixels covered by isometric lines
        coverOrthogonal: caculateCoverage(orthogonal, width, height),
        totalBlacks // Total number of black pixels in the image
    };
}




function highlightLinesInColor(imageData, lines, colorHex) {
    const {
        width,
        height,
        data
    } = imageData;

    // Extract RGBA components (assuming little-endian)
    const r = (colorHex >> 16) & 0xFF;
    const g = (colorHex >> 8) & 0xFF;
    const b = colorHex & 0xFF;

    // Helper: Modify a pixel to green
    function setPixelToGreen(x, y) {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const index = (y * width + x) * 4;
        data[index] = r; // Red channel
        data[index + 1] = g; // Green channel
        data[index + 2] = b; // Blue channel
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

function findFaceMatches(bwPixelData, faceMaskEdges, hflip = false) {
    const {
        width: userW,
        height: userH,
        data: userPixels
    } = bwPixelData;

    // Create a canvas to draw the face mask and retrieve its pixel data
    const maskCanvas = document.createElement('canvas');
    const maskCanvasCtx = maskCanvas.getContext("2d");
    maskCanvas.width = faceMaskEdges.width;
    maskCanvas.height = faceMaskEdges.height;
    maskCanvasCtx.drawImage(faceMaskEdges, 0, 0);
    const maskData = maskCanvasCtx.getImageData(0, 0, faceMaskEdges.width, faceMaskEdges.height);
    const {
        width: maskW,
        height: maskH,
        data: maskPixels
    } = maskData;

    if (maskW > userW || maskH > userH) {
        console.warn('Face mask is larger than the image region - skipping face detection.');
        return [];
    }

    const matches = [];
    const allowedMismatches = 1;

    // If hflip is true, create a horizontally flipped version of the mask
    let flippedMaskPixels = maskPixels;
    if (hflip) {
        flippedMaskPixels = new Uint8ClampedArray(maskPixels.length);
        for (let y = 0; y < maskH; y++) {
            for (let x = 0; x < maskW; x++) {
                const originalIndex = (y * maskW + x) * 4;
                const flippedIndex = (y * maskW + (maskW - x - 1)) * 4;
                flippedMaskPixels[flippedIndex] = maskPixels[originalIndex];         // Red
                flippedMaskPixels[flippedIndex + 1] = maskPixels[originalIndex + 1]; // Green
                flippedMaskPixels[flippedIndex + 2] = maskPixels[originalIndex + 2]; // Blue
                flippedMaskPixels[flippedIndex + 3] = maskPixels[originalIndex + 3]; // Alpha
            }
        }
    }

    // Sliding window: Scan the user image for matching regions
    for (let yWin = 0; yWin <= userH - maskH; yWin++) {
        for (let xWin = 0; xWin <= userW - maskW; xWin++) {
            let mismatches = 0;
            let match = true;

            // Compare the flipped mask (or original) with the current window
            for (let my = 0; my < maskH; my++) {
                for (let mx = 0; mx < maskW; mx++) {
                    const maskIndex = (my * maskW + mx) * 4; // RGBA in mask (flipped if hflip is true)
                    const userIndex = ((yWin + my) * userW + (xWin + mx)) * 4; // RGBA in user image

                    if (flippedMaskPixels[maskIndex] !== userPixels[userIndex]) {
                        mismatches++;
                        if (mismatches > allowedMismatches) {
                            match = false;
                            break; // Exit the inner loop early
                        }
                    }
                }
                if (!match) break; // Exit the middle loop early
            }

            // If a match is found based on the threshold, save the bounding box
            if (match) {
                matches.push({
                    x: xWin,
                    y: yWin,
                    width: maskW,
                    height: maskH
                });
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
    const boxAArea = boxA.width * boxA.height;
    const boxBArea = boxB.width * boxB.height;
    return interArea / (boxAArea + boxBArea - interArea);
}

function nonMaxSuppression(detections, iouThreshold = 0.3) {
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
dragBox.style.top = '0px';

// On mousedown, we store the offsets
dragBox.addEventListener('mousedown', e => {
    dragStart = true;

    // Get the container's bounding rect once (relative to viewport).
    containerRect = cameraContainer.getBoundingClientRect();

    // “Where did we click inside the box?”
    // e.clientX is mouse X in viewport coords; subtract containerRect.left to get coords within container.
    // Then subtract dragBox.offsetLeft to get the difference from the box’s left side.
    offsetX = (e.clientX - containerRect.left) - dragBox.offsetLeft;
    offsetY = (e.clientY - containerRect.top) - dragBox.offsetTop;

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
    let newTop = mouseY - offsetY;

    // Clamp to keep dragBox fully in container
    const maxLeft = containerRect.width - dragBox.offsetWidth;
    const maxTop = containerRect.height - dragBox.offsetHeight;

    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
    newTop = Math.max(0, Math.min(newTop, maxTop));

    dragBox.style.left = `${newLeft}px`;
    dragBox.style.top = `${newTop}px`;

    // Debounce processing
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        processImage();
    }, 100); // 100ms debounce
});

// On mouseup, stop dragging
document.addEventListener('mouseup', () => {
    dragStart = false;
});


case1.addEventListener("click", async () => (userImg = await loadImage("./example/example-ok.jpg"), processImage()));
case2.addEventListener("click", async () => (userImg = await loadImage("./example/example-wrong.jpg"), processImage()));

imageInput.addEventListener('change', async () => {
    const file = imageInput.files[0];
    if (!file) return;
    // A) Load user image if not yet loaded or changed
    userImg = await loadFileAsImage(file);
    processImage();

});

async function processImage() {
    isoCheckResult.textContent = '';
    faceCheckResult.textContent = '';

    if (!userImg) {
        isoCheckResult.textContent = 'No image loaded.';
        return;
    }

    // set container's background to this image
    cameraContainer.style.backgroundImage = `url('${userImg.src}')`;
    // set container size to match the image
    cameraContainer.style.width  = `${userImg.width}px`;
    cameraContainer.style.height = `${userImg.height}px`;

    try {
        // Load Mask
        faceMaskImg = await loadImage('image/faceMaskBorder.jpg')

        // C) When processing is triggered,
        //    we get the cropping area from the draggable box position
        const fixedWidth = 161;
        const fixedHeight = 117;
        const zoom = 1;

        // read box offset
        boxX = parseInt(dragBox.style.left, 10) + 11;
        boxY = parseInt(dragBox.style.top, 10) + 21;

        // Prepare the output canvas
        const outW = fixedWidth * zoom;
        const outH = fixedHeight * zoom;
        outputCanvas.width = outW;
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
        const bwData = toBlackAndWhite(outData, 2);
        if (bwCanvas) {
            bwCanvas.width = outW;
            bwCanvas.height = outH;
            bwCtx.putImageData(bwData, 0, 0);
        }

        const matches = [
            ...findFaceMatches(bwData, faceMaskImg, false),
            ...findFaceMatches(bwData, faceMaskImg, true),
        ]

        faceCheckResult.textContent = matches.length === 0 ? 'No face found above threshold.' : `Found ${matches.length} face(s)`;

        // 1) Use 'findAllLineSegments' to detect lines
        const {
            isometric,
            orthogonal,
            coverIsometric,
            coverOrthogonal,
            totalBlacks
        } = findAllLineSegments(bwData);
        console.log(coverIsometric, coverOrthogonal);

        // 2) Show how many lines we found
        if (isometric.length === 0) {
            isoCheckResult.textContent += `\nNo isometric lines.`;
        } else {
            isoCheckResult.textContent += `\nFound ${isometric.length} isometric line(s).`;
        }

        // Render Debug!
        highlightLinesInColor(bwData, isometric, 0x00FF00);
        highlightLinesInColor(bwData, orthogonal, 0x0000FF);
        bwCtx.putImageData(bwData, 0, 0);

        // Highlight face matches with red rectangles
        matches.forEach(m => {
            bwCtx.strokeStyle = 'red';
            bwCtx.lineWidth = 1;
            bwCtx.strokeRect(m.x, m.y, faceMaskImg.width, faceMaskImg.height);
        });

        // Destructure weights
        const {
            w1,
            w2,
            w3
        } = {
            w1: 0.3,
            w2: 0.3,
            w3: 0.4
        }; // Faces give more!

        // Calculate individual scores
        const scoreC1 = Math.min(coverIsometric / (coverOrthogonal * 0.9), 1); // Already a ratio between 0 and potentially >1
        const scoreC2 = coverIsometric / totalBlacks; // Ratio between 0 and 1
        const scoreC3 = Math.min(matches.length / 3, 1); // Ratio between 0 and 1

        // Calculate total score with weights
        const totalScore = (w1 * scoreC1) + (w2 * scoreC2) + (w3 * scoreC3);

        console.log(totalScore);
        const isValidImage = totalScore >= 0.5;

        // Display the validation result
        if (isValidImage) {
            // Image is valid
            console.log("Yes, the image is valid.");
            // Optionally, update the UI to reflect the valid status
            check.textContent = `✅ = ${totalScore.toFixed(2)}`;
        } else {
            // Image is invalid
            console.log("No, the image is invalid.");
            // Optionally, update the UI to reflect the invalid status
            check.textContent = `❌ =  ${totalScore.toFixed(2)}`;
        }

    } catch (err) {
        console.error(err);
        isoCheckResult.textContent = 'Error: ' + err.message;
    }
}