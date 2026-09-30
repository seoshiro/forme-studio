import { test, expect, type Page } from "@playwright/test";
import { blankProject, type BoardDocument } from "../src/model";

async function openBoard(page: Page, edge = false) {
  const project = blankProject("Synthetic editor audit");
  project.revision = 1;
  project.objects = [
    {
      id: "audit-a",
      type: "swatch",
      title: "Audit A",
      x: edge ? 1100 : 80,
      y: edge ? 700 : 80,
      width: 180,
      height: 180,
      color: "#B8472D",
    },
    {
      id: "audit-b",
      type: "swatch",
      title: "Audit B",
      x: 400,
      y: 400,
      width: 180,
      height: 180,
      color: "#62665D",
    },
  ];
  await page.goto("/");
  await page.locator(".hero").waitFor();
  await page.evaluate(async (doc) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("forme-studio", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("projects", { keyPath: "id" });
        request.result.createObjectStore("images", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("projects", "readwrite");
      tx.objectStore("projects").put(doc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, project);
  await page.goto(`/#/project/${project.id}/board`);
  await expect(page.locator(".board-scene .scene-object")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Заметка", exact: true }),
  ).toBeEnabled();
  return project;
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("forme-studio", 1);
      request.onsuccess = () => resolve(request.result);
    });
    return await new Promise<BoardDocument>((resolve) => {
      const request = db
        .transaction("projects")
        .objectStore("projects")
        .get(location.hash.split("/")[2]);
      request.onsuccess = () => {
        db.close();
        resolve(request.result);
      };
    });
  });
}

const object = (page: Page, name = "A") =>
  page.getByRole("button", { name: `Объект: Audit ${name}`, exact: true });
async function startDrag(page: Page) {
  const target = object(page);
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 70, { steps: 5 });
  return { target, box };
}

test("editor lost pointer capture cancels preview and supports a subsequent one-step gesture", async ({
  page,
}) => {
  const original = await openBoard(page);
  await page.evaluate(() => {
    document.addEventListener("gotpointercapture", (event) => {
      (
        window as unknown as { auditCapture: { target: Element; id: number } }
      ).auditCapture = {
        target: event.target as Element,
        id: (event as PointerEvent).pointerId,
      };
    });
  });
  const { box } = await startDrag(page);
  await page.evaluate(() => {
    const captured = (
      window as unknown as { auditCapture: { target: Element; id: number } }
    ).auditCapture;
    captured.target.releasePointerCapture(captured.id);
  });
  // Browsers process a pending capture release before the next pointer event.
  await page.mouse.move(box.x + 91, box.y + 70);
  await expect(page.locator(".board-viewport")).not.toHaveClass(/dragging/);
  await expect(object(page)).toHaveCSS("left", "80px");
  await page.mouse.up();
  expect((await stored(page)).objects).toEqual(original.objects);
  await startDrag(page);
  await page.mouse.up();
  await expect.poll(async () => (await stored(page)).objects[0].x).not.toBe(80);
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect
    .poll(async () => (await stored(page)).objects)
    .toEqual(original.objects);
});

test("editor ignores unrelated pointer move and release during the active drag", async ({
  page,
}) => {
  await openBoard(page);
  const { target } = await startDrag(page);
  const before = await target.getAttribute("style");
  await page
    .locator(".board-viewport")
    .dispatchEvent("pointermove", {
      pointerId: 99,
      clientX: 1000,
      clientY: 700,
    });
  expect(await target.getAttribute("style")).toBe(before);
  await page
    .locator(".board-viewport")
    .dispatchEvent("pointerup", { pointerId: 99 });
  await expect(page.locator(".board-viewport")).toHaveClass(/dragging/);
  await page.mouse.up();
  await expect(page.locator(".board-viewport")).not.toHaveClass(/dragging/);
});

test("editor Escape and window blur roll back interrupted drags", async ({
  page,
}) => {
  const original = await openBoard(page);
  for (const interruption of ["Escape", "blur"]) {
    await startDrag(page);
    if (interruption === "Escape") await page.keyboard.press("Escape");
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.locator(".board-viewport")).not.toHaveClass(/dragging/);
    await expect(object(page)).toHaveCSS("left", "80px");
    await page.mouse.up();
    expect((await stored(page)).objects).toEqual(original.objects);
  }
});

test("editor pointer cancel restores the view after panning and ignores delayed release", async ({
  page,
}) => {
  await openBoard(page);
  await page
    .getByRole("button", { name: "Перемещение области", exact: true })
    .click();
  const viewport = page.locator(".board-viewport");
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + box.width - 35, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 100, box.y + 90);
  await viewport.dispatchEvent("pointercancel", { pointerId: 1 });
  await expect(page.locator(".board-center")).toHaveAttribute(
    "style",
    /translate\(0px,\s*0px\)/,
  );
  await page.mouse.up();
  await expect(viewport).not.toHaveClass(/dragging/);
});

test("editor hand tool moves the view without selecting the object under the pointer", async ({
  page,
}) => {
  const original = await openBoard(page);
  await page
    .getByRole("button", { name: "Перемещение области", exact: true })
    .click();
  await startDrag(page);
  await page.mouse.up();
  await expect(object(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".board-center")).not.toHaveAttribute(
    "style",
    /translate\(0px,\s*0px\)/,
  );
  await object(page).click();
  await expect(object(page)).toHaveAttribute("aria-pressed", "false");
  expect((await stored(page)).objects).toEqual(original.objects);
});

test("editor bottom-right resize stays anchored when reaching board boundaries", async ({
  page,
}) => {
  await openBoard(page, true);
  await object(page).click();
  const handle = (await page.locator(".resize-handle").boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x + 180, handle.y + 180, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await stored(page)).objects[0])
    .toMatchObject({ x: 1100, y: 700, width: 300, height: 300 });
});

test("editor keyboard edits the focused board object and does not move it from toolbar arrows", async ({
  page,
}) => {
  await openBoard(page);
  await object(page).click();
  await object(page, "B").focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await stored(page)).objects[1].x).toBe(401);
  expect((await stored(page)).objects[0].x).toBe(80);
  await page
    .getByRole("button", { name: "Увеличить масштаб", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(object(page, "B")).toHaveCSS("left", "401px");
});

test("editor keyboard duplicate and delete retain a useful board focus target", async ({
  page,
}) => {
  await openBoard(page);
  await object(page).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+d");
  const copy = page.getByRole("button", {
    name: "Объект: Audit A · копия",
    exact: true,
  });
  await expect(copy).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(object(page, "B")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await stored(page)).objects[1].x).toBe(399);
});

test("editor Ctrl-wheel prevents browser zoom while applying board zoom", async ({
  page,
}) => {
  await openBoard(page);
  const before = await page.locator(".canvas-toolbar output").textContent();
  await page.evaluate(() => {
    document.addEventListener("wheel", (event) => {
      (
        window as unknown as { auditWheelPrevented: boolean }
      ).auditWheelPrevented = event.defaultPrevented;
    });
  });
  await page
    .locator(".board-viewport")
    .dispatchEvent("wheel", { ctrlKey: true, deltaY: -100, cancelable: true });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { auditWheelPrevented: boolean })
          .auditWheelPrevented,
    ),
  ).toBe(true);
  await expect(page.locator(".canvas-toolbar output")).not.toHaveText(before!);
});

test("editor preserves manual pan and zoom when panels or viewport dimensions change", async ({
  page,
}) => {
  await openBoard(page);
  await page
    .getByRole("button", { name: "Увеличить масштаб", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Перемещение области", exact: true })
    .click();
  await startDrag(page);
  await page.mouse.up();
  const zoom = await page.locator(".canvas-toolbar output").textContent();
  const pan = await page.locator(".board-center").getAttribute("style");
  await page
    .getByRole("button", { name: "Скрыть панели", exact: true })
    .click();
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(page.locator(".canvas-toolbar output")).toHaveText(zoom!);
  await expect(page.locator(".board-center")).toHaveAttribute("style", pan!);
  await page
    .getByRole("button", { name: "Вписать доску", exact: true })
    .click();
  await expect(page.locator(".board-center")).toHaveAttribute(
    "style",
    /translate\(0px,\s*0px\)/,
  );
});

test("editor undo during a drag discards its preview and delayed pointer release", async ({
  page,
}) => {
  const original = await openBoard(page);
  await object(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await stored(page)).objects[0].x).toBe(81);
  await startDrag(page);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".board-viewport")).not.toHaveClass(/dragging/);
  await expect(object(page)).toHaveCSS("left", "80px");
  await page.mouse.up();
  await expect
    .poll(async () => (await stored(page)).objects)
    .toEqual(original.objects);
});

test("editor mobile keyboard duplicate and repeated deletion leave visible focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBoard(page);
  await page
    .getByRole("button", { name: "Закрыть материалы", exact: true })
    .click();
  await object(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".properties-heading")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(object(page)).toBeFocused();
  await page.keyboard.press("Control+d");
  await expect(
    page.getByRole("button", { name: "Объект: Audit A · копия", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(object(page, "B")).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(object(page)).toBeFocused();
  await page.keyboard.press("Delete");
  await expect(page.locator(".board-viewport")).toBeFocused();
  await expect(page.locator(".board-scene .scene-object")).toHaveCount(0);
});
