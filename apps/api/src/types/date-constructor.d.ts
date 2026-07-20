export {};

declare global {
  interface DateConstructor {
    new (value: Date): Date;
  }
}
