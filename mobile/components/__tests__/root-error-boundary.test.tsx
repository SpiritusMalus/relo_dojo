// Tests for the global crash screen (rendered by the ErrorBoundary export in app/_layout.tsx).
// It must render WITHOUT any provider (it catches provider failures), report the crash through the
// analytics pipe, and call retry() when the user taps the recover button.
import { createElement, type ReactElement } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { RootErrorBoundary } from "../RootErrorBoundary";
import * as analytics from "../../services/analytics";

function render(node: ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(node);
  });
  return r;
}

const allText = (r: ReactTestRenderer): string =>
  r.root
    .findAll((n) => n.type === "Text")
    .map((n) => {
      const kids = n.props.children as unknown;
      return Array.isArray(kids) ? kids.filter((c) => typeof c === "string").join("") : String(kids ?? "");
    })
    .join(" ");

const button = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.props.accessibilityRole === "button" && typeof n.type !== "string")[0];

describe("RootErrorBoundary", () => {
  // The boundary logs the caught error via console.error by design; silence it so the suite output
  // stays clean (the analytics-reporting test below asserts the real reporting contract).
  let errSpy: jest.SpyInstance;
  beforeEach(() => {
    errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  it("renders a recovery screen with no provider in the tree", () => {
    const r = render(
      createElement(RootErrorBoundary, { error: new Error("boom"), retry: async () => {} })
    );
    expect(allText(r)).toContain("Что-то пошло не так");
    // bilingual safety line for non-Russian users
    expect(allText(r)).toContain("Something went wrong");
  });

  it("calls retry() when the recover button is pressed", () => {
    const retry = jest.fn(async () => {});
    const r = render(createElement(RootErrorBoundary, { error: new Error("boom"), retry }));
    act(() => {
      button(r).props.onPress();
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("reports the crash through analytics so it is not silent", () => {
    const spy = jest.spyOn(analytics, "track");
    render(createElement(RootErrorBoundary, { error: new Error("kaboom"), retry: async () => {} }));
    const crash = spy.mock.calls.find(([name]) => name === "app_crash");
    expect(crash).toBeDefined();
    expect(crash?.[1]).toMatchObject({ message: "kaboom", fatal: true });
    spy.mockRestore();
  });
});
