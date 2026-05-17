# Source geography labels from dimension values

Explorer-facing labels for geographic observation dimensions come from `dimension_values`, not directly from the existing `departamentos` table. `departamentos` may be used as a seed source for department labels, but the Explorer uses the same dimension registry for `GEO_LEVEL`, `DEPT_CODE`, and future `MUNI_CODE` labels so geographic filters behave like all other observation dimensions.
