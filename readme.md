# Image Validation Project

## Project Description

This project focuses on analyzing uploaded images to determine their validity based on specific criteria. The process involves detecting geometric features, identifying the presence of faces, and computing a final score that decides whether the image passes validation. 

The system is designed to ensure that uploaded images meet predefined quality standards, such as alignment and feature detection. 

## Validation Process

1. **Line Detection**: 
   The system identifies various line types, such as horizontal, vertical, and isometric lines. These lines are analyzed for their coverage and relation to the total black pixel count in the image.

2. **Face Detection**: 
   A pre-defined mask is used to identify faces within the cropped area of the image. The number of matches contributes significantly to the overall score.

3. **Score Calculation**:
   The image is scored based on:
   - The coverage of detected isometric lines relative to orthogonal lines.
   - The ratio of isometric lines to the total number of black pixels.
   - The presence and number of detected faces.

   A weighted scoring system ensures that face detection plays a critical role in determining validity.

4. **Final Decision**:
   If the weighted score exceeds a certain threshold, the image is considered valid. Otherwise, it fails the validation.

## Challenge: Overlapping Images

Currently, the system can be bypassed by overlapping an isometric image and a standard image. This approach can manipulate the detection results to favor validation. For example:
- Adding a face to the image can boost the score without penalizing the manipulation.
- Overlapping conflicting features (e.g., orthogonal and isometric lines) creates discrepancies in detection.

## TODO

- [ ] **Enhance Overlap Detection**: Implement checks to identify and penalize instances where conflicting image features are deliberately overlapped to manipulate the results. This enhancement will ensure that manipulated images fail the validation process.
