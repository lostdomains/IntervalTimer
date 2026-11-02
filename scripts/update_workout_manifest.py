#!/usr/bin/env python3
"""Refresh the JSON inventory for static hosts without directory listings.

Run from any directory: python3 scripts/update_workout_manifest.py
The manifest lives outside workouts/ so it is never mistaken for a workout.
"""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
folder = root / 'workouts'
files = sorted(path.name for path in folder.iterdir()
               if path.is_file() and path.suffix.lower() == '.json')
for name in files:
    data = json.loads((folder / name).read_text(encoding='utf-8'))
    if not isinstance(data, dict) or data.get('version') != 1 or not isinstance(data.get('workouts'), list):
        raise ValueError(f'{name}: expected version 1 and a workouts array')
output = root / 'workouts-manifest.json'
output.write_text(json.dumps({'version': 1, 'files': files}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Updated {output.name}: {len(files)} JSON files.')
