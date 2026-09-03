// A CSS module import is an object of scoped class names, one per class in the file.
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
