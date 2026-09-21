interface ActiveXObject {}

declare var ActiveXObject: {
  prototype: ActiveXObject;
  new (...args: string[]): ActiveXObject;
};
