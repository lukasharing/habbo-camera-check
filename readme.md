# Image Validation Project

## Project Description

This project focuses on analyzing uploaded images to determine their validity based on specific criteria. The process involves detecting geometric features, identifying the presence of faces, and computing a final score to decide whether the image passes validation. 

The system ensures that uploaded images meet predefined quality standards, such as proper alignment, clear feature detection, and face presence.

## Validation Process

1. **Line Detection**: 
   Identifies various line types, including horizontal, vertical, and isometric lines. Coverage and proportionality of these lines are evaluated in relation to the image’s black pixel distribution.

2. **Face Detection**: 
   Uses a predefined mask to detect faces in the cropped area. The detection of faces and their number significantly impacts the overall score.

3. **Score Calculation**:
   Combines results from line detection and face detection using a weighted system. The system assigns a higher weight to face presence to ensure its significance in validation.

4. **Final Decision**:
   Images with scores exceeding a predefined threshold are deemed valid, ensuring they meet all the required standards.

## Challenges

1. **Overlapping Images**: 
   The system can be manipulated by overlapping isometric and standard images. This can create conflicting detections that favor validation, such as combining face elements without penalizing overlaps.

2. **Varied Environments and Expressions**: 
   Current functionality may be limited in detecting faces across different rooms or varied facial expressions.

## TODO

- [ ] **Detect Overlapping Images**: Enhance the system to identify and penalize deliberately manipulated images with overlapping features, ensuring a fair validation process.

- [ ] **Work with More Rooms**: Adapt detection mechanisms to handle images from diverse environments, improving versatility.

- [ ] **Work with More Face Expressions**: Train the system to recognize and validate a broader range of facial expressions for robust face detection.
