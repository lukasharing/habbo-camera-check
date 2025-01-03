# Image Validation Project

## Project Description

This project focuses on analyzing uploaded images to determine their validity based on specific criteria. The process involves detecting geometric features, identifying the presence of faces, and computing a final score to decide whether the image passes validation. 

The system ensures that uploaded images meet predefined quality standards, such as proper alignment, clear feature detection, and face presence.


## Validation Process

The image validation workflow encompasses several key stages, each contributing to the comprehensive assessment of the uploaded image:

1. **Image Loading and Preparation**:
    - **File Handling**: The system accepts image files and prepares them for processing by loading them into memory for analysis.
    - **Cropping Area Selection**: A designated area within the image is selected for validation. This area is defined by specific coordinates and dimensions to focus the analysis on relevant sections.

2. **Black and White Conversion**:
    - **Grayscale Transformation**: The selected image area is converted to grayscale to simplify subsequent analysis by reducing color complexity.
    - **Thresholding**: A binary threshold is applied to convert the grayscale image into a black-and-white format. Pixels above the threshold are set to white, and those below are set to black, highlighting significant features for further processing.

3. **Line Detection**:
    - **Horizontal and Vertical Lines**: The system identifies continuous runs of black pixels in horizontal and vertical orientations. These lines are detected by scanning each row and column for uninterrupted sequences of black pixels that meet a minimum length criterion.
    - **Isometric Lines**: Diagonal lines with specific slopes (e.g., ±1, ±2, ±0.5) are detected to assess the geometric structure of the image. The algorithm scans the image in multiple diagonal directions to identify these isometric lines.
    - **Blob Detection**: The algorithm identifies and excludes blob-like structures to prevent false positives in line detection. A blob is detected when a pixel and its immediate neighbors in all four primary directions (left, right, up, down) are black.
    - **Coverage Calculation**: The proportion of black pixels covered by isometric and orthogonal lines is calculated relative to the total number of black pixels in the image. This metric evaluates the image's geometric integrity.

4. **Face Detection**:
    - **Mask-Based Matching**: Predefined face and neck masks are used to scan the binary image for potential matches. The system overlays these masks onto the image at various positions to identify regions that match the mask patterns.
    - **Horizontal Flipping**: Both original and horizontally flipped versions of the masks are employed to ensure accurate detection regardless of face orientation.
    - **Match Ratio**: The number of detected face matches influences the overall validation score. The ratio of detected faces to expected matches is calculated to assess the presence and prominence of faces within the image.

5. **Grid Partitioning and Weighted Scoring**:
    - **Image Segmentation**: The image is divided into a grid (e.g., 7 columns by 9 rows) to analyze the distribution of detected lines across different regions. This partitioning allows for localized assessment of geometric features.
    - **Weighted Metrics**: Each grid cell is assigned a weight based on its distance from the image center, using an exponential decay function. This weighting prioritizes central areas of the image, reflecting their importance in the overall validation.
    - **Score Computation**: Individual scores from isometric coverage, face matches, and grid distribution are combined using predefined weights to calculate a final validation score. The scoring system balances the contribution of geometric integrity and face presence to determine the image's validity.

6. **Final Decision and Feedback**:
    - **Threshold Evaluation**: The final score is compared against a predefined threshold (e.g., 0.5) to determine the image's validity. Images scoring above the threshold are deemed valid.
    - **Result Interpretation**: Detailed metrics, including individual scores and the total weighted score, are generated to provide a comprehensive overview of the image's compliance with validation criteria.

## Challenges

1. **Varied Environments and Expressions**: 
   Current functionality may be limited in detecting faces across different rooms or varied facial expressions.

## TODO

- [ ] **Work with More Rooms**: Adapt detection mechanisms to handle images from diverse environments, improving versatility.

- [ ] **Work with More Face Expressions**: Train the system to recognize and validate a broader range of facial expressions for robust face detection.
