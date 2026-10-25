# Reverted cycles: the guards that broke, run again on the reverted builds

## R1 C1.4 (reverted to C1.3)

- G1 (K3, O4, born C1.1): `transform --input input.csv --recipe recipe.json --output output.csv --seed 1`; rests on R1.S3.P2. Replayed: fail (not_landed/missing_name).
  - o4_exit (R1.S3.P2, derived): expected 0, got 1
  - o4_columns_order (R1.S3.P2, derived): expected id,category,value,q1
2,B,20,3
1,A,10,1
, got (missing)
- G2 (K10, O11, born C1.1): `transform --input input.csv --recipe recipe.json --output output.csv --seed 1`; rests on R1.S3.P22, R1.S3.P23. Replayed: fail (not_landed/missing_name).
  - o11_exit (R1.S3.P23, derived): expected 0, got 1
  - o11_output (R1.S3.P23, derived): expected id,value
1,
2,A
3,A
4,B
5,B
, got (missing)
- G3 (K13, O14, born C1.1): `pipeline --config config.json`; rests on R1.S6. Replayed: fail (not_landed/missing_name).
  - o14_exit (R1.S6.P2, derived): expected 0, got 1
  - o14_stdout (R1.S6.P2, derived): expected PIPELINE OK: 1 steps completed
, got 
- G6 (K9, O10, born C1.2): `transform --input input.csv --recipe recipe.json --output output.csv --seed 1`; rests on R1.S3.P20, R1.S3.P21. Replayed: fail (not_landed/missing_name).
  - o10_exit (R1.S3.P21, derived): expected 0, got 1
  - o10_output (R1.S3.P21, derived): expected id,quarter,amount
1,q1,10
1,q2,
2,q1,
2,q2,20
, got (missing)
- G7 (G7, O7, born C1.2): `transform --input left.csv --recipe recipe.json --output output.csv --seed 1`; rests on R1.S3.P12.s1, R1.S3.P12.s2, R1.S3.P12.s3.c1, R1.S3.P12.s3.c2, R1.S3.P12.s4, R1.S3.P12.s6.c1, R1.S3.P12.s6.c2, R1.S3.P12.s6.c3, R1.S3.P12.s6.c4, R1.S3.P12.s6.c5, R1.S3.P12.s7.c1, R1.S3.P12.s7.c2, R1.S3.P12.s8.c1, R1.S3.P12.s8.c2, R1.S3.P12.s8.c3, R1.S3.P12.s8.c4, R1.S3.P12.s9.c1, R1.S3.P12.s9.c2, R1.S3.P12.s9.c3. Replayed: fail (not_landed/missing_name).
  - a1 (—, derived): expected id,name,score
2,b,
1,a,10
3,c,
, got (missing)
- G8 (G8, O10, born C1.2): `transform --input input.csv --recipe recipe.json --output output.csv --seed 1`; rests on R1.S3.P20.s1.c1, R1.S3.P20.s2.c1, R1.S3.P20.s3, R1.S3.P20.s4, R1.S3.P21.s1, R1.S3.P21.s2.c1, R1.S3.P21.s2.c2, R1.S3.P21.s3.c1, R1.S3.P21.s3.c2, R1.S3.P21.s3.c3, R1.S3.P21.s3.c4, R1.S3.P21.s4.c1, R1.S3.P21.s4.c2, R1.S3.P21.s4.c3, R1.S3.P21.s4.c4, R1.S3.P21.s5.c1, R1.S3.P21.s5.c2. Replayed: fail (not_landed/missing_name).
  - a1 (—, derived): expected id,quarter,amount
1,q1,10
1,q2,
2,q1,
2,q2,20
, got (missing)
- G9 (G9, O16, born C1.2): `manifest --dir review-fixtures/no-such-dir --output review-fixtures/missing-manifest.json`; rests on R1.S8.P1.s1.c1, R1.S8.P1.s1.c2. Replayed: fail (not_landed/missing_name).
  - a2 (R1.S8.P1.s1.c2, verbatim): expected ERROR: file not found: review-fixtures/no-such-dir, got ERROR: unknown command: manifest
- G10 (G10, O6, born C1.3): `transform --input review_sort.csv --recipe review_sort.json --output review_sort_out.csv --seed 1`; rests on R1.S3.P9.s2. Replayed: fail (not_landed/missing_name).
  - a5 (—, derived): expected x
1
2
10
, got (missing)

## R2 C2.3 (reverted to C2.2)

- G27 (K19, O19, born C2.2): `transform --input in.csv --recipe recipe.json --output out.csv --seed 1`; rests on R2.S9, R2.S9.P1, R2.S9.P2, R2.S9.P3. Replayed: fail (not_landed/missing_name).
  - split-output (R2.S9.P3, derived): expected id,first,last,city
1,Alice,Smith,Paris
2,Bob,,London
3,Carol,Ann Jones,Rome
, got id,first,last,city
1,Alice,Smith,Paris
2,Bob,,London
3,Carol,Ann,Rome

- G33 (G33, O19, born C2.2): `transform --input review_split.csv --recipe review_split.json --output review_split_out.csv --seed 1`; rests on R2.S9.P1.s1.c1, R2.S9.P3.s4, R2.S9.P3.s6.c1, R2.S9.P3.s7. Replayed: fail (not_landed/missing_name).
  - a10_file (R2.S9.P3.s6.c1, derived): expected id,first,last,city
1,Alice,Smith,Paris
2,Bob,,London
3,Carol,Ann Jones,Rome
, got id,first,last,city
1,Alice,Smith,Paris
2,Bob,,London
3,Carol,Ann,Rome


## R2 C2.4 (reverted to C2.2)

- G27 (K19, O19, born C2.2): `transform --input in.csv --recipe recipe.json --output out.csv --seed 1`; rests on R2.S9, R2.S9.P1, R2.S9.P2, R2.S9.P3. Replayed: fail (not_landed/missing_name).
  - split-output (R2.S9.P3, derived): expected id,first,last,city
1,Alice,Smith,Paris
2,Bob,,London
3,Carol,Ann Jones,Rome
, got id,first,last,city
1,Alice,Smith,Paris
2,Bob,,London
3,Carol,Ann,Rome

- G33 (G33, O19, born C2.2): `transform --input review_split.csv --recipe review_split.json --output review_split_out.csv --seed 1`; rests on R2.S9.P1.s1.c1, R2.S9.P3.s4, R2.S9.P3.s6.c1, R2.S9.P3.s7. Replayed: fail (not_landed/missing_name).
  - a10_file (R2.S9.P3.s6.c1, derived): expected id,first,last,city
1,Alice,Smith,Paris
2,Bob,,London
3,Carol,Ann Jones,Rome
, got id,first,last,city
1,Alice,Smith,Paris
2,Bob,,London
3,Carol,Ann,Rome

- G36 (G36, O22, born C2.2): `transform --input review_transform.csv --recipe review_encode.json --output review_encode_out.csv --seed 1`; rests on R2.S14.P3.s2, R2.S14.P8.s1.c1, R2.S14.P8.s2.c1, R2.S14.P8.s3.c2, R2.S14.P8.s4. Replayed: fail (not_landed/missing_name).
  - a13_file (R2.S14.P8.s2.c1, derived): expected id,value,code
1,1,0
2,,
3,,
4,7,1
5,9,2
, got id,value
1,1,0
2,,
3,,
4,7,1
5,9,2


## R3 C3.2 (reverted to C3.1)

- G41 (K32, O28, born C3.1): `drift --baseline baseline.csv --current current.csv --output drift.json --threshold 0.1`; rests on R3.S6, R3.S8.P1, R3.S8.P3, R3.S8.P5, R3.S9.P3, R3.S10.P2. Replayed: fail (not_landed/missing_name).
  - total (R3.S8.P5, derived): expected 2, got 1
  - schema (R3.S8.P3, verbatim): expected column_added, got (missing)
  - mean_detail (R3.S9.P3, derived): expected normalized shift = 4, got new column of type string

## R3 C3.3 (reverted to C3.1)

- G41 (K32, O28, born C3.1): `drift --baseline baseline.csv --current current.csv --output drift.json --threshold 0.1`; rests on R3.S6, R3.S8.P1, R3.S8.P3, R3.S8.P5, R3.S9.P3, R3.S10.P2. Replayed: fail (not_landed/missing_name).
  - total (R3.S8.P5, derived): expected 2, got 1
  - schema (R3.S8.P3, verbatim): expected column_added, got (missing)
  - mean_detail (R3.S9.P3, derived): expected normalized shift = 4, got new column of type string

## R3 C3.4 (reverted to C3.1)

- G41 (K32, O28, born C3.1): `drift --baseline baseline.csv --current current.csv --output drift.json --threshold 0.1`; rests on R3.S6, R3.S8.P1, R3.S8.P3, R3.S8.P5, R3.S9.P3, R3.S10.P2. Replayed: fail (not_landed/missing_name).
  - total (R3.S8.P5, derived): expected 2, got 1
  - schema (R3.S8.P3, verbatim): expected column_added, got (missing)
  - mean_detail (R3.S9.P3, derived): expected normalized shift = 4, got new column of type string

## R4 C4.2 (reverted to C4.1)

- G40 (K30, O21, born C3.1): `transform --input data.csv --recipe recipe.json --output out.csv --seed 1`; rests on R3.S3.P1, R3.S3.P2, R3.S3.P3, R3.S3.P4. Replayed: fail (not_landed/missing_name).
  - norm1 (R3.S3.P2, derived): expected -1, got -1.224744871391589
  - norm3 (R3.S3.P2, derived): expected 1, got 1.224744871391589
- G50 (K31, O17, born C4.1): `profile --input data.csv --output profile.json`; rests on R3.S5.P1, R3.S5.P2, R3.S5.P3. Replayed: fail (not_landed/missing_name).
  - p05 (R3.S5.P3, derived): expected 1.2, got (missing)
  - p95 (R3.S5.P3, derived): expected 4.8, got (missing)

## R4 C4.3 (reverted to C4.1)

- G40 (K30, O21, born C3.1): `transform --input data.csv --recipe recipe.json --output out.csv --seed 1`; rests on R3.S3.P1, R3.S3.P2, R3.S3.P3, R3.S3.P4. Replayed: fail (not_landed/missing_name).
  - norm1 (R3.S3.P2, derived): expected -1, got -1.224744871391589
  - norm3 (R3.S3.P2, derived): expected 1, got 1.224744871391589
- G50 (K31, O17, born C4.1): `profile --input data.csv --output profile.json`; rests on R3.S5.P1, R3.S5.P2, R3.S5.P3. Replayed: fail (not_landed/missing_name).
  - p05 (R3.S5.P3, derived): expected 1.2, got (missing)
  - p95 (R3.S5.P3, derived): expected 4.8, got (missing)

## R4 C4.4 (reverted to C4.1)

- G40 (K30, O21, born C3.1): `transform --input data.csv --recipe recipe.json --output out.csv --seed 1`; rests on R3.S3.P1, R3.S3.P2, R3.S3.P3, R3.S3.P4. Replayed: fail (not_landed/missing_name).
  - norm1 (R3.S3.P2, derived): expected -1, got -1.224744871391589
  - norm3 (R3.S3.P2, derived): expected 1, got 1.224744871391589

## R5 C5.3 (reverted to C5.2)

- G85 (G85, O28, born C5.2): `drift --baseline base.csv --current curr.csv --output drift.json`; rests on R3.S8.P3.s1, R3.S8.P4.s1, R3.S10.P2.s2.c1, R3.S10.P2.s2.c6, R3.S10.P2.s2.c7. Replayed: fail (not_landed/missing_name).
  - a11d (—, derived): expected null_rate_change, got mean_shift
  - a11e (—, derived): expected range_expansion, got null_rate_change
- G99 (G99, O14, born C5.2): `pipeline --config review-pipeline-fail.json`; rests on R1.S6.P2.s2, R1.S6.P2.s3. Replayed: fail (not_landed/missing_name).
  - a2 (R1.S6.P2.s3, verbatim): expected PIPELINE FAILED at step 1: file not found: missing.csv, got 

## R5 C5.4 (reverted to C5.2)

- G85 (G85, O28, born C5.2): `drift --baseline base.csv --current curr.csv --output drift.json`; rests on R3.S8.P3.s1, R3.S8.P4.s1, R3.S10.P2.s2.c1, R3.S10.P2.s2.c6, R3.S10.P2.s2.c7. Replayed: fail (not_landed/missing_name).
  - a11d (—, derived): expected null_rate_change, got mean_shift
  - a11e (—, derived): expected range_expansion, got null_rate_change
- G99 (G99, O14, born C5.2): `pipeline --config review-pipeline-fail.json`; rests on R1.S6.P2.s2, R1.S6.P2.s3. Replayed: fail (not_landed/missing_name).
  - a2 (R1.S6.P2.s3, verbatim): expected PIPELINE FAILED at step 1: file not found: missing.csv, got 

## R6 C6.2 (reverted to C6.1)

- G130 (G130, O26, born C6.1): `compare --left review-left.csv --right review-right-dup.csv --key id --output out-compare-dup.json`; rests on R2.S20.P1.s11.c1, R2.S20.P1.s11.c2. Replayed: fail (not_landed/missing_name).
  - compare.right_rows (—, derived): expected 3, got 4

## R6 C6.3 (reverted to C6.1)

- G105 (K38, O12, born C5.5): `verify --file data.bin --checksum data.checksum`; rests on R1.S4, R5.S1.P1, R5.S1.P2.s1, R5.S1.P2.s6, R5.S1.P3.s3. Replayed: fail (not_landed/missing_name).
  - verify-exit (R1.S4.P2.s2.c1, verbatim): expected 0, got 1
  - verify-stdout (R1.S4.P2.s2.c1, verbatim): expected VERIFIED, got MISMATCH expected=a3fd8436a207a1551ee71a714344164941e97485b3e334293c1a4038f934e088 actual=838b0a2ba808a375252fc254629a23402772b422bd6ced8251a2242411d2752b
- G120 (K42, O1, born C6.1): `verify --file data.csv --checksum data.chk --audit audit.json`; rests on R6.S1.P1, R6.S2.P1, R6.S2.P3. Replayed: fail (not_landed/missing_name).
  - exit (R1.S4.P2, verbatim): expected 0, got 1
  - verified (R1.S4.P2, verbatim): expected VERIFIED, got MISMATCH expected=4a91358ad6cd7780d39cdb468ec4a026c342ed30ae623461aebb0d76b1a51d23 actual=7cde7fb64fd82bd152710cf238e017b9ab46c0592483edc067ba4f6c75fac108
  - success (R1.S4.P2, derived): expected true, got false
  - error (R1.S4.P2, derived): expected null, got verification mismatch
- G121 (K43, O35, born C6.1): `verify --file data.csv --checksum data.chk --audit audit.json`; rests on R6.S1, R6.S2.P1, R6.S2.P2, R6.S2.P3, R6.S3.P1. Replayed: fail (not_landed/missing_name).
  - exit (R1.S4.P2, verbatim): expected 0, got 1
  - success (R1.S4.P2, derived): expected true, got false
  - error (R1.S4.P2, derived): expected null, got verification mismatch
- G130 (G130, O26, born C6.1): `compare --left review-left.csv --right review-right-dup.csv --key id --output out-compare-dup.json`; rests on R2.S20.P1.s11.c1, R2.S20.P1.s11.c2. Replayed: fail (not_landed/missing_name).
  - compare.right_rows (—, derived): expected 3, got 4

## R6 C6.4 (reverted to C6.1)

- G105 (K38, O12, born C5.5): `verify --file data.bin --checksum data.checksum`; rests on R1.S4, R5.S1.P1, R5.S1.P2.s1, R5.S1.P2.s6, R5.S1.P3.s3. Replayed: fail (not_landed/missing_name).
  - verify-exit (R1.S4.P2.s2.c1, verbatim): expected 0, got 1
  - verify-stdout (R1.S4.P2.s2.c1, verbatim): expected VERIFIED, got MISMATCH expected=a3fd8436a207a1551ee71a714344164941e97485b3e334293c1a4038f934e088 actual=838b0a2ba808a375252fc254629a23402772b422bd6ced8251a2242411d2752b
- G109 (G109, O21, born C5.5): `transform --input normalize-one.csv --recipe normalize-one.json --output normalize-one-out.csv --seed 1`; rests on R3.S3.P3.s2.c1. Replayed: fail (not_landed/missing_name).
  - a1 (—, derived): expected value,norm
10,0
bad,0
, got value,norm
10,0
,0
bad,0

- G119 (G119, O21, born C5.5): `transform --input review-one.csv --recipe review-normalize.json --output out-one.csv`; rests on R3.S3.P3.s2. Replayed: fail (not_landed/missing_name).
  - normalize.invalid (R3.S3.P3.s2, verbatim): expected bad,0, got ,0
- G120 (K42, O1, born C6.1): `verify --file data.csv --checksum data.chk --audit audit.json`; rests on R6.S1.P1, R6.S2.P1, R6.S2.P3. Replayed: fail (not_landed/missing_name).
  - exit (R1.S4.P2, verbatim): expected 0, got 1
  - verified (R1.S4.P2, verbatim): expected VERIFIED, got MISMATCH expected=4a91358ad6cd7780d39cdb468ec4a026c342ed30ae623461aebb0d76b1a51d23 actual=7cde7fb64fd82bd152710cf238e017b9ab46c0592483edc067ba4f6c75fac108
  - success (R1.S4.P2, derived): expected true, got false
  - error (R1.S4.P2, derived): expected null, got verification mismatch
- G121 (K43, O35, born C6.1): `verify --file data.csv --checksum data.chk --audit audit.json`; rests on R6.S1, R6.S2.P1, R6.S2.P2, R6.S2.P3, R6.S3.P1. Replayed: fail (not_landed/missing_name).
  - exit (R1.S4.P2, verbatim): expected 0, got 1
  - success (R1.S4.P2, derived): expected true, got false
  - error (R1.S4.P2, derived): expected null, got verification mismatch
- G130 (G130, O26, born C6.1): `compare --left review-left.csv --right review-right-dup.csv --key id --output out-compare-dup.json`; rests on R2.S20.P1.s11.c1, R2.S20.P1.s11.c2. Replayed: fail (not_landed/missing_name).
  - compare.right_rows (—, derived): expected 3, got 4

