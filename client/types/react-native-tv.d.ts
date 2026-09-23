declare module "react-native/Libraries/Components/View/ViewNativeComponent" {
  interface ViewCommands {
    requestTVFocus(viewRef: any): void;
    setDestinations(viewRef: any, destinations: number[]): void;
  }
  const Commands: ViewCommands;
  export { Commands };
}