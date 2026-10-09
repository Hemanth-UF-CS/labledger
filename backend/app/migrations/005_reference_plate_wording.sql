-- Camera frames are of a white reference plate, not bare soil; align descriptive text.
UPDATE projects SET description =
    'Classifies surface wetness at each field node as wet (1) or dry (0) from the latest frame of its white '
    'reference plate and the preceding sensor window. Runs on the Raspberry Pi nodes as an int8 TFLite model; '
    'output feeds the FieldSense dashboard and irrigation alerts.'
WHERE slug = 'wetdry';

UPDATE datasets SET description =
    'Top-down Pi Camera Module 3 frames of each node''s white reference plate (beaded droplets = wet), each aligned '
    'with the 2 h of sensor readings before capture. Labels from manual annotation plus rain-gauge cross-check.'
WHERE slug = 'wetdry-frames';

UPDATE model_versions SET notes = 'Frame-only baseline. Misses thin films and fine dew at dusk.'
WHERE name = 'wetdry' AND version = '0.1.0';
UPDATE model_versions SET notes = 'Synthetic shadow augmentation fixes most false wets from shadows across the plate.'
WHERE name = 'wetdry' AND version = '1.4.0';
