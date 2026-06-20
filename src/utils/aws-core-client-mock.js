// Mock file to override the unsupported Node-only version check in AWS SDK v3
export * from "../../node_modules/@aws-sdk/core/dist-es/submodules/client/index.browser.js";
export const emitWarningIfUnsupportedVersion = () => {};
