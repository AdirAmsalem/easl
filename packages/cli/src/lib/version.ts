declare const __PACKAGE_VERSION__: string | undefined;
declare const __PACKAGE_NAME__: string | undefined;
declare const __BINARY_BUILD__: boolean | undefined;

export const VERSION: string =
  typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : '0.0.0-dev';

export const PACKAGE_NAME: string =
  typeof __PACKAGE_NAME__ !== 'undefined' ? __PACKAGE_NAME__ : '@easl/cli';

export const IS_BINARY: boolean =
  typeof __BINARY_BUILD__ !== 'undefined' ? __BINARY_BUILD__ : false;
