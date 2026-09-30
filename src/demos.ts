import {
  blankProject,
  uid,
  type BoardDocument,
  type BoardObject,
} from "./model";
import { processImage } from "./images";
import { writeProject, type StoredImage } from "./storage";
export const demos = [
  {
    id: "architecture",
    name: "Тихая архитектура",
    caption: "Геометрия. Воздух. Тёплый камень.",
    category: "Пространство",
    photos: [1, 2, 3, 4],
    colors: ["#e3d9c8", "#bfa38a", "#6b7462", "#313b32", "#f4efe6", "#af593c"],
  },
  {
    id: "objects",
    name: "Предметы и свет",
    caption: "Красота в самых простых вещах.",
    category: "Предметы",
    photos: [5, 6, 7, 8],
    colors: ["#eae2d4", "#bbb39e", "#82755e", "#3c4030", "#f7f4eb", "#bd7649"],
  },
  {
    id: "city",
    name: "Город после дождя",
    caption: "Ритмы улиц и отражения света.",
    category: "Наблюдения",
    photos: [9, 10, 11, 12],
    colors: ["#d8dfdf", "#8eacb9", "#445667", "#222f3d", "#f5f1e6", "#bc6c43"],
  },
] as const;
const imageNames = [
  "Свет и линии",
  "Вертикальный ритм",
  "Личное пространство",
  "Тактильная тишина",
];
export function demoDocument(index: number): BoardDocument {
  const demo = demos[index],
    doc = blankProject(demo.name);
  doc.id = `preview-${demo.id}`;
  doc.demo = true;
  doc.description = demo.caption;
  doc.materials = demo.photos.map((n, i) => ({
    id: `photo-${n}`,
    type: "image",
    title: imageNames[i],
    tags: [demo.category.toLowerCase(), i % 2 ? "детали" : "свет"],
    favorite: i === 0,
    blobId: `preview-${n}`,
    width: 1000,
    height: 1000,
    colors: [...demo.colors],
  }));
  const geometries = [
    [72, 72, 510, 550],
    [610, 72, 340, 320],
    [610, 420, 340, 342],
    [980, 390, 340, 460],
  ];
  doc.objects = doc.materials.map(
    (m, i) =>
      ({
        id: `object-${i}`,
        type: "image",
        title: m.title,
        assetId: m.id,
        x: geometries[i][0],
        y: geometries[i][1],
        width: geometries[i][2],
        height: geometries[i][3],
      }) as BoardObject,
  );
  doc.objects.push({
    id: "note",
    type: "note",
    title: "Направление",
    text:
      index === 0
        ? "Искать тишину\nв простых формах."
        : index === 1
          ? "Немного света.\nИ ничего лишнего."
          : "Сохранить ритм.\nПоймать отражение.",
    x: 72,
    y: 654,
    width: 510,
    height: 220,
    color: "#e8e4d6",
    fontSize: 28,
  });
  doc.objects.push(
    ...demo.colors
      .slice(0, 3)
      .map((color, i) => ({
        id: `color-${i}`,
        type: "swatch" as const,
        title: color,
        x: 980 + i * 112,
        y: 212,
        width: 100,
        height: 100,
        color,
      })),
  );
  doc.kit.colors = {
    background: demo.colors[4],
    surface: "#FFFEFB",
    text: demo.colors[3],
    muted: index === 0 ? "#62665D" : demo.colors[2],
    accent: demo.colors[5],
  };
  return doc;
}
export async function createDemo(index: number) {
  const doc = demoDocument(index);
  doc.id = uid();
  const images: StoredImage[] = [];
  for (let i = 0; i < doc.materials.length; i++) {
    const material = doc.materials[i];
    const response = await fetch(`/images/photo-${demos[index].photos[i]}.jpg`);
    if (!response.ok)
      throw new Error("Не удалось загрузить материалы примера.");
    const source = await response.blob();
    const processed = await processImage(source);
    const id = uid();
    material.blobId = id;
    material.width = processed.width;
    material.height = processed.height;
    material.colors = processed.colors;
    images.push({
      id,
      blob: new Blob([source], { type: processed.mime }),
      thumbnail: processed.thumbnail,
    });
  }
  doc.revision = await writeProject(doc, 0, images);
  return doc;
}
export function demoUrls(index: number) {
  return Object.fromEntries(
    demos[index].photos.map((n) => [`photo-${n}`, `/images/photo-${n}.jpg`]),
  );
}
