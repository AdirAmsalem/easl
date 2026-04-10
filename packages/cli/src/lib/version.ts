declare const __PACKAGE_VERSION__: string | undefined;
declare const __PACKAGE_NAME__: string | undefined;

export const VERSION: string =
  typeof __PACKAGE_VERSION__ !== 'undefined' ? __PACKAGE_VERSION__ : '0.0.0-dev';

export const PACKAGE_NAME: string =
  typeof __PACKAGE_NAME__ !== 'undefined' ? __PACKAGE_NAME__ : '@easl/cli';
