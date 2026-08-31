const BUCKET = "wwb-session-images";
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

function extensionFor(type) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressImage(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("画像ファイルを選択してください。");
  const bitmap = await loadBitmap(file);
  const sourceWidth = bitmap.width || bitmap.naturalWidth;
  const sourceHeight = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();
  const type = file.type === "image/png" && file.size < 1_500_000 ? "image/png" : "image/jpeg";
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("画像の変換に失敗しました。")), type, type === "image/jpeg" ? JPEG_QUALITY : undefined);
  });
  return { blob, type, extension: extensionFor(type) };
}

export async function listSessionImages(supabase, sessionId) {
  const { data, error } = await supabase.from("session_images")
    .select("*").eq("session_id", sessionId).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const withUrls = await Promise.all(rows.map(async (row) => {
    const { data: signed, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 3600);
    return { ...row, signed_url: signedError ? null : signed?.signedUrl ?? null };
  }));
  return withUrls;
}

export async function uploadSessionImage(supabase, sessionId, userId, file, caption = "") {
  const { blob, type, extension } = await compressImage(file);
  const objectName = `${sessionId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectName, blob, {
    contentType: type,
    upsert: false,
    cacheControl: "3600",
  });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase.from("session_images").insert({
    session_id: sessionId,
    storage_path: objectName,
    caption: String(caption || "").trim() || null,
    uploaded_by: userId,
  }).select("*").single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([objectName]);
    throw error;
  }
  return data;
}

export async function deleteSessionImage(supabase, image) {
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([image.storage_path]);
  if (storageError) throw storageError;
  const { error } = await supabase.from("session_images").delete().eq("id", image.id);
  if (error) throw error;
}

export async function removeAllSessionImageObjects(supabase, images) {
  const paths = (images ?? []).map((image) => image.storage_path).filter(Boolean);
  if (!paths.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw error;
}
