# Compound It Right

A webcam watches a student's hands during a step-by-step pharmacy compounding procedure and flags technique problems live, then exports a CSV/JSON report. It is a teaching aid: flags are prompts for the instructor, not a final grade. The video never leaves the device and it works offline.

## Run
Browsers only allow the webcam on `localhost` or https, so opening `index.html` directly will not work.

```
npm run serve      # then open http://localhost:8080
```

## What it detects today (hand tracking only)
Hands leaving the aseptic work zone (drag on the video to redraw it), unsteady hands, moving too fast, wrong hand angle (e.g. syringe not tip-up), too few hands on the task, hands out of camera view, and steps finished too quickly or too slowly.

## What it cannot detect yet
The syringe, needle, vial or plunger themselves (wrong volume, bevel orientation, touching the needle). That needs an object-detection model trained on photos of your own apparatus. The rule engine in `js/rules.js` is built so a detector can feed into it.

## Configure
Edit `data/protocol.json` for steps, rules and thresholds. The shipped values are an **example**: tune them against your lab SOP before using it for assessment.

## Test
`npm test`

Hand tracking: MediaPipe Hands, bundled in `vendor/mediapipe-hands/` (see its LICENSE-NOTE.md).
