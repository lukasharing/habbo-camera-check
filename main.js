// ----------------------------------------------------
// DOM Refs
// ----------------------------------------------------
const imageInput       = document.getElementById('imageInput');
const xCoordInput      = document.getElementById('xCoord');
const yCoordInput      = document.getElementById('yCoord');
const zoomInput        = document.getElementById('zoomInput');
const fixedSizeInput   = document.getElementById('fixedSize');

const maskCanvas       = document.getElementById('maskCanvas');
const maskCtx          = maskCanvas.getContext('2d');
const outputCanvas     = document.getElementById('outputCanvas');
const outputCtx        = outputCanvas.getContext('2d');
const sobelCanvas      = document.getElementById('sobelCanvas');
const sobelCtx         = sobelCanvas.getContext('2d');

const maskCheckResult  = document.getElementById('maskCheckResult');
const isoCheckResult   = document.getElementById('isoCheckResult');
const faceCheckResult  = document.getElementById('faceCheckResult');
const sobelFaceCanvas  = document.getElementById('sobelFace');

const maskImg          = new Image();
maskImg.src            = 'image/mask.jpg'; // green/blue/red mask
let maskLoaded         = false;
maskImg.onload         = () => {
    maskLoaded = true;
    console.log('Mask loaded:', maskImg.width, maskImg.height);
};

const faceMaskImg      = new Image();
faceMaskImg.src        = 'image/faceMaskEdges.jpg'; // grayscale face mask
let faceMaskLoaded     = false;
faceMaskImg.onload     = () => {
    faceMaskLoaded = true;
    console.log('Face mask loaded:', faceMaskImg.width, faceMaskImg.height);
};

// ----------------------------------------------------
// 1) Utility to load file as an Image
// ----------------------------------------------------
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

// ----------------------------------------------------
// 2) Three-Color Mask Validation
// ----------------------------------------------------
function validateThreeColorMask(userImg, maskImg) {
    const w = userImg.width;
    const h = userImg.height;

    // Offscreen for mask
    const maskOff = document.createElement('canvas');
    maskOff.width  = w;
    maskOff.height = h;
    const maskCtxOff = maskOff.getContext('2d');
    maskCtxOff.drawImage(maskImg, 0, 0);
    const maskData = maskCtxOff.getImageData(0, 0, w, h).data;

    // Offscreen for user
    const userOff = document.createElement('canvas');
    userOff.width  = w;
    userOff.height = h;
    const userCtxOff = userOff.getContext('2d');
    userCtxOff.drawImage(userImg, 0, 0);
    const userData = userCtxOff.getImageData(0, 0, w, h).data;

    let totalGreen = 0, blackInGreen = 0;
    let totalBlue  = 0, blackInBlue  = 0;

    for (let i = 0; i < maskData.length; i += 4) {
        const [rM, gM, bM, aM] = [
            maskData[i], maskData[i+1], maskData[i+2], maskData[i+3]
        ];
        if (aM < 10) continue; // near-transparent => ignore

        // Identify green or blue region from mask
        const isGreen = (rM < 20 && gM > 200 && bM < 20);
        const isBlue  = (rM < 20 && gM < 20  && bM > 200);

        if (isGreen) {
            totalGreen++;
            const [rU, gU, bU, aU] = [
                userData[i], userData[i+1], userData[i+2], userData[i+3]
            ];
            if (aU > 20 && rU < 20 && gU < 20 && bU < 20) {
                blackInGreen++;
            }
        } else if (isBlue) {
            totalBlue++;
            const [rU, gU, bU, aU] = [
                userData[i], userData[i+1], userData[i+2], userData[i+3]
            ];
            if (aU > 20 && rU < 20 && gU < 20 && bU < 20) {
                blackInBlue++;
            }
        }
        // else => red => no constraint
    }

    const greenRatio = totalGreen ? (blackInGreen / totalGreen) : 1;
    const blueRatio  = totalBlue  ? (blackInBlue  / totalBlue)  : 1;

    const greenOk = (greenRatio >= 0.99);
    const blueOk  = (blueRatio  >= 0.60);

    return { greenOk, greenRatio, blueOk, blueRatio };
}

function drawMaskPreview(userImg, maskImg, ctx) {
    // Overlays the mask half-transparent
    ctx.clearRect(0, 0, userImg.width, userImg.height);
    ctx.canvas.width  = userImg.width;
    ctx.canvas.height = userImg.height;
    ctx.drawImage(userImg, 0, 0);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(maskImg, 0, 0);
    ctx.globalAlpha = 1.0;
}

// ----------------------------------------------------
// 3) Sobel Helper: Single function to get all data
// ----------------------------------------------------
function blurImageData(imageData, kernelSize = 3) {
    const { width, height, data } = imageData;
    // We'll store the blurred pixels in a temporary array
    const output = new Uint8ClampedArray(data.length);

    // For a 3x3 box blur
    const kernel = [
        1,1,1,
        1,1,1,
        1,1,1
    ];
    const kernelSum = 9;

    // Helper to safely get pixel (clamp if out of bounds)
    function getPixel(x, y, c) {
        x = Math.max(0, Math.min(width  - 1, x));
        y = Math.max(0, Math.min(height - 1, y));
        return data[(y * width + x) * 4 + c];
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            // Accumulate for R, G, B separately
            let r = 0, g = 0, b = 0;
            let kIdx = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const px = x + kx, py = y + ky;
                    const weight = kernel[kIdx++];
                    r += getPixel(px, py, 0) * weight;
                    g += getPixel(px, py, 1) * weight;
                    b += getPixel(px, py, 2) * weight;
                }
            }
            const outPos = (y * width + x) * 4;
            output[outPos + 0] = r / kernelSum;
            output[outPos + 1] = g / kernelSum;
            output[outPos + 2] = b / kernelSum;
            output[outPos + 3] = 255; // keep alpha 100%
        }
    }

    // Copy blurred data back into imageData
    for (let i = 0; i < data.length; i++) {
        data[i] = output[i];
    }
}

// Specialiced for pixelarts!
function getSobelDataPixelArt(imageData) {
    const { width, height, data } = imageData;

    // 1) Grayscale Conversion
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // 2) Sobel Convolution Kernels
    const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    const magArr = new Float32Array(width * height);
    const angArr = new Float32Array(width * height);

    /**
     * Modified getGray function to handle boundaries by replicating edge pixels
     */
    function getGray(x, y) {
        // Clamp x and y to the image boundaries
        x = Math.max(0, Math.min(x, width - 1));
        y = Math.max(0, Math.min(y, height - 1));
        return gray[y * width + x];
    }

    // 3) Apply Sobel Operator
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

    // 4) Normalize Magnitudes
    let maxMag = 0;
    for (let i = 0; i < magArr.length; i++) {
        if (magArr[i] > maxMag) maxMag = magArr[i];
    }

    // 5) Apply Threshold and Create Edge Image Data
    const threshold = 20; // Adjust based on your image
    const edgeData = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < magArr.length; i++) {
        let val = (magArr[i] / maxMag) * 255;
        val = val > threshold ? 255 : 0; // Binary edge map
        edgeData[i * 4 + 0] = val; // Red
        edgeData[i * 4 + 1] = val; // Green
        edgeData[i * 4 + 2] = val; // Blue
        edgeData[i * 4 + 3] = 255; // Alpha
    }

    // 6) Return the Result
    return {
        width,
        height,
        edgeMagnitudes: magArr,
        edgeAngles: angArr,
        edgeImage: edgeData
    };
}

// ----------------------------------------------------
// 4) Isometric check
// ----------------------------------------------------
function getIsometricScore(magArr, angArr, width, height, threshold = 20) {
    let totalEdges = 0, isoEdges = 0;
    for (let i = 0; i < magArr.length; i++) {
        if (magArr[i] > threshold) {
            totalEdges++;
            const angle = angArr[i];
            if (isIsometricAngle(angle, 8)) {
                isoEdges++;
            }
        }
    }
    return (totalEdges > 0) ? (isoEdges / totalEdges) * 100 : 0;
}
function isIsometricAngle(angle, tolerance) {
    const isoAngles = [30, 150, 210, 330];
    return isoAngles.some(a => {
        const diff = Math.min(Math.abs(a - angle), 360 - Math.abs(a - angle));
        return diff <= tolerance;
    });
}

//----------------------------------------------------
// 5. Face Check (using edge overlap) - now with precomputed mask edges
//----------------------------------------------------
async function findFaceMatches(userCanvas, faceMaskEdges, sobelFaceCanvas) {
    // 1) Compute Sobel for user-canvas
    const userCtx   = userCanvas.getContext('2d');
    const userImage = userCtx.getImageData(0, 0, userCanvas.width, userCanvas.height);
    const userSobel = getSobelDataPixelArt(userImage); 

    // 2) The faceMaskEdges is already a black/white edge map
    const off = document.createElement('canvas');
    off.width  = faceMaskEdges.width;
    off.height = faceMaskEdges.height;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(faceMaskEdges, 0, 0);
    const maskData = offCtx.getImageData(0, 0, faceMaskEdges.width, faceMaskEdges.height);
    
    // Convert face mask edges to a Float32Array (maskMagArr)
    const maskMagArr = new Float32Array(maskData.width * maskData.height);
    for (let i = 0; i < maskMagArr.length; i++) {
        const val = maskData.data[i * 4 + 0]; // R
        maskMagArr[i] = val;
    }

    // (Optional) Display in sobelFaceCanvas
    if (sobelFaceCanvas) {
        sobelFaceCanvas.width  = maskData.width;
        sobelFaceCanvas.height = maskData.height;
        const sobelFaceCtx = sobelFaceCanvas.getContext('2d');
        sobelFaceCtx.putImageData(maskData, 0, 0);
    }

    // 3) Overlap logic
    const userW = userCanvas.width, userH = userCanvas.height;
    const maskW = maskData.width,  maskH = maskData.height;
    if (maskW > userW || maskH > userH) {
        console.warn('Face mask is larger than the cropped region - skipping.');
        return [];
    }

    const userMagArr = userSobel.edgeMagnitudes;

    // Precompute a reference "maskSum" if you want to normalize your scores
    // For example, sum of (maskVal^2) so we can do a correlation measure.
    let maskSumSq = 0;
    for (let i = 0; i < maskMagArr.length; i++) {
        maskSumSq += (maskMagArr[i] * maskMagArr[i]);
    }
    // A small epsilon to avoid division by zero
    const eps = 1e-8;

    // We'll collect all (score, x, y)
    const matches = [];
    for (let yWin = 0; yWin <= userH - maskH; yWin++) {
        for (let xWin = 0; xWin <= userW - maskW; xWin++) {
            let dotProd = 0;
            let userSumSq = 0; 

            for (let my = 0; my < maskH; my++) {
                for (let mx = 0; mx < maskW; mx++) {
                    const maskVal = maskMagArr[my * maskW + mx];
                    if (maskVal < 10) continue; // skip weak mask edges

                    const userPos = (yWin + my) * userW + (xWin + mx);
                    const userVal = userMagArr[userPos];
                    dotProd += (maskVal * userVal);
                    userSumSq += (userVal * userVal);
                }
            }
            // We'll measure correlation:
            //    corr = dotProd / ( sqrt(maskSumSq)* sqrt(userSumSq) )
            // Range typically [0..1]
            const corr = dotProd / (Math.sqrt(maskSumSq + eps) * Math.sqrt(userSumSq + eps));
            
            // Store the result
            matches.push({
                x: xWin,
                y: yWin,
                correlation: corr
            });
        }
    }
    return matches;
}


function iou(boxA, boxB) {
    // box = {x, y, width, height}
    const xA = Math.max(boxA.x, boxB.x);
    const yA = Math.max(boxA.y, boxB.y);
    const xB = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
    const yB = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea  = boxA.width * boxA.height;
    const boxBArea  = boxB.width * boxB.height;
    const iouVal    = interArea / (boxAArea + boxBArea - interArea);
    return iouVal;
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

// ----------------------------------------------------
// 6) Main entry point to do everything at once
// ----------------------------------------------------
document.getElementById('processBtn').addEventListener('click', async () => {
    // Clear messages
    maskCheckResult.textContent = '';
    isoCheckResult.textContent  = '';
    faceCheckResult.textContent = '';

    const file = imageInput.files[0];
    if (!file) {
        maskCheckResult.textContent = 'No image selected.';
        return;
    }
    if (!maskLoaded) {
        maskCheckResult.textContent = 'Mask is still loading, try again soon.';
        return;
    }

    try {
        // ------------------------------------------------
        // (A) Load the user image
        // ------------------------------------------------
        const userImg = await loadFileAsImage(file);

        // Must match mask dimension
        if (userImg.width !== maskImg.width || userImg.height !== maskImg.height) {
            maskCheckResult.textContent = 'User image must match mask dimension!';
            return;
        }

        // ------------------------------------------------
        // (B) Mask validation
        // ------------------------------------------------
        const { greenOk, greenRatio, blueOk, blueRatio } =
            validateThreeColorMask(userImg, maskImg);

        // Draw preview
        drawMaskPreview(userImg, maskImg, maskCtx);

        let msg = `Green Test: ${greenOk ? 'PASSED' : 'FAILED'} (ratio=${greenRatio.toFixed(2)})\n`;
        msg    += `Blue Test:  ${blueOk  ? 'PASSED' : 'FAILED'} (ratio=${blueRatio.toFixed(2)})\n`;
        maskCheckResult.textContent = msg;

        if (!greenOk || !blueOk) {
            // If either fails, stop.
            return;
        }

        // ------------------------------------------------
        // (C) Crop + zoom
        // ------------------------------------------------
        const fixedSize = parseInt(fixedSizeInput.value, 10);
        const x = parseInt(xCoordInput.value, 10);
        const y = parseInt(yCoordInput.value, 10);
        const zoom = parseFloat(zoomInput.value);

        const maxX = userImg.width - fixedSize;
        const maxY = userImg.height - fixedSize;
        const clampedX = Math.max(0, Math.min(x, maxX));
        const clampedY = Math.max(0, Math.min(y, maxY));

        const outW = fixedSize * zoom;
        const outH = fixedSize * zoom;
        outputCanvas.width  = outW;
        outputCanvas.height = outH;

        // Draw user-cropped region (scaled)
        outputCtx.clearRect(0, 0, outW, outH);
        outputCtx.drawImage(
            userImg,
            clampedX, clampedY,
            fixedSize, fixedSize,
            0, 0,
            outW, outH
        );

        // ------------------------------------------------
        // (D) Sobel Isometric check
        // ------------------------------------------------
        const outData = outputCtx.getImageData(0, 0, outW, outH);
        const sobel    = getSobelDataPixelArt(outData);

        // Show the “edge map” on sobelCanvas
        sobelCanvas.width  = sobel.width;
        sobelCanvas.height = sobel.height;
        sobelCtx.putImageData(
            new ImageData(sobel.edgeImage, sobel.width, sobel.height), 
            0, 0
        );

        // Isometric score
        const isoScore = getIsometricScore(
            sobel.edgeMagnitudes, 
            sobel.edgeAngles, 
            sobel.width, 
            sobel.height, 
            /* threshold = */ 20
        );
        isoCheckResult.textContent = `Isometric Score: ${isoScore.toFixed(2)}% (>=10% is a likely pass)`;

        // ------------------------------------------------
        // (E) Face check (if faceMask is loaded)
        // ------------------------------------------------
        if (!faceMaskLoaded) {
            faceCheckResult.textContent = 'Face mask still loading – skipping face check.';
        } else {
           
             // In your main logic
            const matches = await findFaceMatches(outputCanvas, faceMaskImg, sobelFaceCanvas);

            // Filter by some threshold
            const threshold = 0.97; // you can tune this
            const goodMatches = matches.filter(m => m.correlation > threshold);
            // Sort descending by correlation
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
                // We'll draw them all. Or just the top 3, etc.
                finalBoxes.forEach(m => {
                    outputCtx.strokeStyle = 'lime';
                    outputCtx.lineWidth   = 2;
                    outputCtx.strokeRect(m.x, m.y, faceMaskImg.width, faceMaskImg.height);
                });
                faceCheckResult.textContent = `Found ${finalBoxes.length} faces (corr > ${threshold}).`;
            }

        }

    } catch (err) {
        console.error(err);
        maskCheckResult.textContent = 'Error: ' + err.message;
    }
});
