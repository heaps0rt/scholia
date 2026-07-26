# Scholia for macOS

This directory contains a focused native prototype for cross-application text
selection. The Swift package provides:

- an Accessibility permission boundary;
- focused-app selected-text reading;
- normalized text/LaTeX/image request models;
- a native preview window.

Run the development app with:

```sh
cd apps/macos
swift run ScholiaMac
```

Provider requests and screen-region capture are not exposed by this target.
Shipping either feature requires a complete native implementation, appropriate
privacy descriptions and entitlements, and an explicit signing strategy.
