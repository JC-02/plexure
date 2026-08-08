/**
 * Pointer-claim registry: only one element-scoped field reacts to the pointer at a time.
 *
 * The stack is kept ordered outermost-first, so the innermost hovered field owns the
 * pointer. Order is enforced by DOM containment rather than claim time, because claims can
 * arrive in bubble order (innermost first) when a field re-claims on pointermove after a
 * window blur. Viewport- and page-scoped fields do not claim; they react only while no
 * element-scoped field holds the pointer.
 */
interface Claim {
  field: object;
  host: Element;
}

const stack: Claim[] = [];

export function claimPointer(field: object, host: Element): void {
  const existing = stack.findIndex((c) => c.field === field);
  if (existing !== -1) stack.splice(existing, 1);
  // Insert below any claim whose host is a descendant of this one.
  let at = stack.length;
  for (let i = 0; i < stack.length; i++) {
    if (host !== stack[i].host && host.contains(stack[i].host)) {
      at = i;
      break;
    }
  }
  stack.splice(at, 0, { field, host });
}

export function releasePointer(field: object): void {
  const i = stack.findIndex((c) => c.field === field);
  if (i !== -1) stack.splice(i, 1);
}

export function pointerOwner(): object | null {
  return stack.length ? stack[stack.length - 1].field : null;
}
