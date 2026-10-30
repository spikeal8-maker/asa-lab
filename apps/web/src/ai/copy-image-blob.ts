async function pngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('image conversion unavailable');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error('image conversion failed'))),
        'image/png',
      ),
    );
  } finally {
    bitmap.close();
  }
}

export async function copyImageBlob(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
    throw new Error('image clipboard unavailable');
  // Call write in the user gesture; conversion may finish asynchronously.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(blob) })]);
}
