// Minimal local types for react-test-renderer (the published @types lags React 19). Declares only
// the surface our component render tests use, so tsc stays strict without an external dependency.
declare module "react-test-renderer" {
  import type { ReactElement } from "react";

  export interface ReactTestInstance {
    type: unknown;
    props: { [key: string]: any };
    findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    toJSON(): unknown;
    unmount(): void;
  }

  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => void | Promise<void>): void;

  const _default: { create: typeof create; act: typeof act };
  export default _default;
}
