"""CPU-only reproduction of the local Qwen3-4B FP8 conversion; never overwrites weights."""
import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source, target = args.source.resolve(), args.output.resolve()
    if source == target or target.exists() or not target.parent.is_dir():
        parser.error('Output must be a new file in an existing directory; source is never replaced.')
    before = source.stat()
    if before.st_size != 8044982048:
        parser.error('Expected the 8044982048-byte original BF16 encoder, not an already converted file.')
    # Use the documented ComfyUI Python environment, not a second CUDA/Python installation.
    import torch
    from safetensors import safe_open
    from safetensors.torch import save_file
    torch.set_num_threads(2)
    tensors, clipped = {}, []
    temporary = target.with_name('.' + target.name + '.' + uuid.uuid4().hex + '.partial')
    try:
        with safe_open(str(source), framework='pt', device='cpu') as weights:
            for name in weights.keys():
                value = weights.get_tensor(name)
                if value.is_floating_point():
                    maximum = value.abs().max().item()
                    if not torch.isfinite(torch.tensor(maximum)):
                        raise ValueError('Nonfinite source tensor: ' + name)
                    if maximum > 448:
                        clipped.append(name)
                        value = value.clamp(-448, 448)
                    value = value.to(torch.float8_e4m3fn)
                tensors[name] = value.contiguous()
            save_file(tensors, str(temporary), metadata={
                'derived_from': source.name,
                'conversion': 'float8_e4m3fn; original preserved',
                'created': '2026-10-28',
            })
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise RuntimeError('Source changed during conversion; output is not published.')
        count = len(tensors)
        del tensors
        gc.collect()
        # Same-directory hard link publishes atomically and fails if output appeared meanwhile.
        # NTFS/ext4 required; failure leaves the original and any existing output untouched.
        os.link(temporary, target)
        digest = hashlib.sha256()
        with target.open('rb') as output:
            for chunk in iter(lambda: output.read(4 * 1024 * 1024), b''):
                digest.update(chunk)
        print(json.dumps({'bytes': target.stat().st_size, 'sha256': digest.hexdigest(),
                          'tensors': count, 'clippedTensors': clipped, 'sourceUnchanged': True}))
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
