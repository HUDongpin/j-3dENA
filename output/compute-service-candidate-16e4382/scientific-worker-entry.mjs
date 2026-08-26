import { createHash } from "node:crypto";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __esmMin = (fn, res, err) => () => {
	if (err) throw err[0];
	try {
		return fn && (res = fn(fn = 0)), res;
	} catch (e) {
		throw err = [e], e;
	}
};
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region node_modules/jena-js/dist/chunk-FSSJXZD4.js
function assertNonEmptyColumns(columns, label) {
	if (columns.length === 0) throw new Error(`${label} must contain at least one column name.`);
}
function assertRowsHaveColumns(rows, columns, label = "rows") {
	const missing = /* @__PURE__ */ new Set();
	for (const row of rows) for (const column of columns) if (!(column in row)) missing.add(column);
	if (missing.size > 0) throw new Error(`${label} are missing required columns: ${[...missing].join(", ")}`);
}
function assertRectangularMatrix(matrix, label = "matrix") {
	if (matrix.length === 0) return;
	const width = matrix[0]?.length ?? 0;
	for (let i = 0; i < matrix.length; i += 1) if ((matrix[i]?.length ?? 0) !== width) throw new Error(`${label} must be rectangular; row ${i} has a different width.`);
}
function assertFiniteNumbers(matrix, label = "matrix") {
	for (let row = 0; row < matrix.length; row += 1) for (let col = 0; col < (matrix[row]?.length ?? 0); col += 1) {
		const value = matrix[row]?.[col];
		if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`${label}[${row}][${col}] must be a number, got ${String(value)}.`);
	}
}
function cloneMatrix(matrix) {
	return matrix.map((row) => [...row]);
}
function zeros$1(rows, cols) {
	return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
}
function triIndices(length, row = -1) {
	if (!Number.isInteger(length) || length < 0) throw new Error("length must be a non-negative integer.");
	const first = [];
	const second = [];
	for (let i = 1; i < length; i += 1) for (let j = 0; j < i; j += 1) {
		first.push(j);
		second.push(i);
	}
	if (row === 0) return [first];
	if (row === 1) return [second];
	return [first, second];
}
function adjacencyKey(codes) {
	const indices = triIndices(codes.length);
	const sources = indices[0] ?? [];
	const targets = indices[1] ?? [];
	return sources.map((sourceIndex, i) => {
		const targetIndex = targets[i] ?? 0;
		const source = codes[sourceIndex] ?? String(sourceIndex);
		const target = codes[targetIndex] ?? String(targetIndex);
		return {
			source,
			target,
			name: `${source} & ${target}`,
			sourceIndex,
			targetIndex
		};
	});
}
function orderedAdjacencyKey(codes) {
	const entries = [];
	for (let responseIndex = 0; responseIndex < codes.length; responseIndex += 1) for (let groundIndex = 0; groundIndex < codes.length; groundIndex += 1) {
		const source = codes[groundIndex] ?? String(groundIndex);
		const target = codes[responseIndex] ?? String(responseIndex);
		entries.push({
			source,
			target,
			name: `${source} & ${target}`,
			sourceIndex: groundIndex,
			targetIndex: responseIndex
		});
	}
	return entries;
}
function vectorToUpperTriangle(vector) {
	const out = [];
	for (let i = 1; i < vector.length; i += 1) for (let j = 0; j < i; j += 1) out.push((vector[j] ?? 0) * (vector[i] ?? 0));
	return out;
}
function stringVectorToUpperTriangle(values) {
	const out = [];
	for (let i = 1; i < values.length; i += 1) for (let j = 0; j < i; j += 1) out.push(`${values[j] ?? ""} & ${values[i] ?? ""}`);
	return out;
}
function sumColumns(matrix) {
	if (matrix.length === 0) return [];
	const width = matrix[0]?.length ?? 0;
	const sums = Array.from({ length: width }, () => 0);
	for (const row of matrix) for (let col = 0; col < width; col += 1) sums[col] = (sums[col] ?? 0) + (row[col] ?? 0);
	return sums;
}
function meanColumns(matrix) {
	if (matrix.length === 0) return [];
	return sumColumns(matrix).map((sum) => sum / matrix.length);
}
function subtractVectors$1(a, b) {
	const length = Math.max(a.length, b.length);
	return Array.from({ length }, (_, i) => (a[i] ?? 0) - (b[i] ?? 0));
}
function scaleVector(vector, scalar) {
	return vector.map((value) => value * scalar);
}
function dot(a, b) {
	const length = Math.max(a.length, b.length);
	let total = 0;
	for (let i = 0; i < length; i += 1) total += (a[i] ?? 0) * (b[i] ?? 0);
	return total;
}
function scaledL2State(vector) {
	let scale = 0;
	let scaledSumSquares = 1;
	let hasNaN = false;
	let hasInfinity = false;
	for (const value of vector) {
		if (Number.isNaN(value)) {
			hasNaN = true;
			continue;
		}
		const magnitude = Math.abs(value);
		if (magnitude === Number.POSITIVE_INFINITY) {
			hasInfinity = true;
			continue;
		}
		if (magnitude === 0) continue;
		if (scale < magnitude) {
			const ratio = scale / magnitude;
			scaledSumSquares = 1 + scaledSumSquares * ratio * ratio;
			scale = magnitude;
		} else {
			const ratio = magnitude / scale;
			scaledSumSquares += ratio * ratio;
		}
	}
	return {
		scale,
		scaledSumSquares,
		hasNaN,
		hasInfinity
	};
}
function l2Norm(vector) {
	const state = scaledL2State(vector);
	if (state.hasNaN) return NaN;
	if (state.hasInfinity) return Number.POSITIVE_INFINITY;
	return state.scale === 0 ? 0 : state.scale * Math.sqrt(state.scaledSumSquares);
}
function sphereNorm(matrix) {
	assertRectangularMatrix(matrix);
	assertFiniteNumbers(matrix);
	return matrix.map((row) => {
		const state = scaledL2State(row);
		if (state.hasInfinity) return row.map((value) => value / Number.POSITIVE_INFINITY);
		if (state.scale === 0) return row.map(() => 0);
		const scaledNorm = Math.sqrt(state.scaledSumSquares);
		return row.map((value) => value / state.scale / scaledNorm);
	});
}
function centerData(matrix, centerVector = meanColumns(matrix)) {
	assertRectangularMatrix(matrix);
	assertFiniteNumbers(matrix);
	return matrix.map((row) => row.map((value, columnIndex) => value - (centerVector[columnIndex] ?? 0)));
}
function transpose(matrix) {
	if (matrix.length === 0) return [];
	const rows = matrix.length;
	const cols = matrix[0]?.length ?? 0;
	const out = zeros$1(cols, rows);
	for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
		const outRow = out[col];
		if (outRow) outRow[row] = matrix[row]?.[col] ?? 0;
	}
	return out;
}
function multiplyMatrices(a, b) {
	assertRectangularMatrix(a, "a");
	assertRectangularMatrix(b, "b");
	const aRows = a.length;
	const aCols = a[0]?.length ?? 0;
	const bRows = b.length;
	const bCols = b[0]?.length ?? 0;
	if (aCols !== bRows) throw new Error(`Matrix dimensions do not align: ${aRows}x${aCols} times ${bRows}x${bCols}.`);
	const out = zeros$1(aRows, bCols);
	for (let i = 0; i < aRows; i += 1) for (let j = 0; j < bCols; j += 1) {
		let total = 0;
		for (let k = 0; k < aCols; k += 1) total += (a[i]?.[k] ?? 0) * (b[k]?.[j] ?? 0);
		const outRow = out[i];
		if (outRow) outRow[j] = total;
	}
	return out;
}
function varianceColumns(matrix) {
	if (matrix.length < 2) return (matrix[0] ?? []).map(() => 0);
	const means = meanColumns(matrix);
	const sums = Array.from({ length: means.length }, () => 0);
	for (const row of matrix) for (let col = 0; col < means.length; col += 1) sums[col] = (sums[col] ?? 0) + Math.pow((row[col] ?? 0) - (means[col] ?? 0), 2);
	return sums.map((sum) => sum / (matrix.length - 1));
}
function identity(n) {
	return Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_unused, col) => row === col ? 1 : 0));
}
function solveLinearSystem(a, b, ridge = 1e-10) {
	const n = a.length;
	const aug = a.map((row, i) => row.map((value, j) => value + (i === j ? ridge : 0)).concat(b[i] ?? 0));
	for (let col = 0; col < n; col += 1) {
		let pivot = col;
		for (let row = col + 1; row < n; row += 1) if (Math.abs(aug[row]?.[col] ?? 0) > Math.abs(aug[pivot]?.[col] ?? 0)) pivot = row;
		const pivotRow = aug[pivot];
		const currentRow = aug[col];
		if (!pivotRow || !currentRow) throw new Error("Invalid augmented matrix.");
		if (Math.abs(pivotRow[col] ?? 0) < 1e-14) continue;
		aug[pivot] = currentRow;
		aug[col] = pivotRow;
		const divisor = aug[col]?.[col] ?? 1;
		for (let j = col; j <= n; j += 1) {
			const row = aug[col];
			if (row) row[j] = (row[j] ?? 0) / divisor;
		}
		for (let rowIndex = 0; rowIndex < n; rowIndex += 1) {
			if (rowIndex === col) continue;
			const factor = aug[rowIndex]?.[col] ?? 0;
			for (let j = col; j <= n; j += 1) {
				const row = aug[rowIndex];
				if (row) row[j] = (row[j] ?? 0) - factor * (aug[col]?.[j] ?? 0);
			}
		}
	}
	return aug.map((row) => row[n] ?? 0);
}
function normalizeVector(vector) {
	const norm = l2Norm(vector);
	return norm > 0 ? vector.map((value) => value / norm) : vector.map(() => 0);
}
function subtractOuterProjection(matrix, vector) {
	const unit = normalizeVector(vector);
	return matrix.map((row) => {
		const projection = dot(row, unit);
		return subtractVectors$1(row, scaleVector(unit, projection));
	});
}
function gramSchmidtComplete(columns, dimension, tolerance = 1e-10) {
	const basisColumns = [];
	const candidateColumns = [...columns, ...Array.from({ length: dimension }, (_unused, index) => Array.from({ length: dimension }, (_u, row) => row === index ? 1 : 0))];
	for (const candidate of candidateColumns) {
		let vector = Array.from({ length: dimension }, (_unused, index) => candidate[index] ?? 0);
		for (const basis of basisColumns) vector = subtractVectors$1(vector, scaleVector(basis, dot(vector, basis)));
		const norm = l2Norm(vector);
		if (norm > tolerance) basisColumns.push(vector.map((value) => value / norm));
		if (basisColumns.length === dimension) break;
	}
	return Array.from({ length: dimension }, (_unused, row) => basisColumns.map((column) => column[row] ?? 0));
}
function designSolve(design, response, ridge = 0) {
	const xt = transpose(design);
	const xtx = multiplyMatrices(xt, design);
	const xty = multiplyMatrices(xt, response);
	const cols = response[0]?.length ?? 0;
	const coefficientsByColumn = [];
	for (let col = 0; col < cols; col += 1) coefficientsByColumn.push(solveLinearSystem(xtx, xty.map((row) => row[col] ?? 0), ridge));
	return transpose(coefficientsByColumn);
}
function symmetricJacobiEigen(input, maxSweeps = 100, tolerance) {
	const n = input.length;
	const a = cloneMatrix(input);
	const v = identity(n);
	let scale = 0;
	for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) scale = Math.max(scale, Math.abs(a[i]?.[j] ?? 0));
	const stopThreshold = tolerance ?? Math.max(Number.MIN_VALUE, scale * 1e-15);
	for (let sweep = 0; sweep < maxSweeps && n >= 2; sweep += 1) {
		let rotatedAny = false;
		for (let p = 0; p < n - 1; p += 1) for (let q = p + 1; q < n; q += 1) {
			const apq = a[p]?.[q] ?? 0;
			if (Math.abs(apq) <= stopThreshold) continue;
			rotatedAny = true;
			const app = a[p]?.[p] ?? 0;
			const aqq = a[q]?.[q] ?? 0;
			const theta = .5 * Math.atan2(2 * apq, aqq - app);
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			for (let i = 0; i < n; i += 1) {
				const matrixRow = a[i];
				const aip = matrixRow?.[p] ?? 0;
				const aiq = matrixRow?.[q] ?? 0;
				if (matrixRow) {
					matrixRow[p] = c * aip - s * aiq;
					matrixRow[q] = s * aip + c * aiq;
				}
			}
			const rowP = a[p];
			const rowQ = a[q];
			for (let j = 0; j < n; j += 1) {
				const apj = rowP?.[j] ?? 0;
				const aqj = rowQ?.[j] ?? 0;
				if (rowP) rowP[j] = c * apj - s * aqj;
				if (rowQ) rowQ[j] = s * apj + c * aqj;
			}
			if (rowP) rowP[q] = 0;
			if (rowQ) rowQ[p] = 0;
			for (let i = 0; i < n; i += 1) {
				const vectorRow = v[i];
				const vip = vectorRow?.[p] ?? 0;
				const viq = vectorRow?.[q] ?? 0;
				if (vectorRow) {
					vectorRow[p] = c * vip - s * viq;
					vectorRow[q] = s * vip + c * viq;
				}
			}
		}
		if (!rotatedAny) break;
	}
	const pairs = Array.from({ length: n }, (_, i) => ({
		value: a[i]?.[i] ?? 0,
		index: i
	})).sort((left, right) => right.value - left.value);
	return {
		eigenvalues: pairs.map((pair) => Math.max(0, pair.value)),
		eigenvectors: Array.from({ length: n }, (_, row) => pairs.map((pair) => v[row]?.[pair.index] ?? 0))
	};
}
function covarianceLike(matrix) {
	if (matrix.length === 0) return [];
	return multiplyMatrices(transpose(matrix), matrix);
}
var init_chunk_FSSJXZD4 = __esmMin((() => {}));
//#endregion
//#region node_modules/jena-js/dist/chunk-B5R3F624.js
function scalarToString(value) {
	return value === null ? "" : String(value);
}
function mergeColumns(row, columns, separator = "::") {
	return columns.map((column) => scalarToString(row[column] ?? null)).join(separator);
}
function typedScalarIdentity(value) {
	if (value === void 0) return ["undefined"];
	if (value === null) return ["null"];
	if (typeof value === "string") return ["string", value];
	if (typeof value === "boolean") return ["boolean", value ? "true" : "false"];
	if (Number.isNaN(value)) return ["number", "NaN"];
	if (value === Number.POSITIVE_INFINITY) return ["number", "Infinity"];
	if (value === Number.NEGATIVE_INFINITY) return ["number", "-Infinity"];
	if (Object.is(value, -0)) return ["number", "-0"];
	return ["number", String(value)];
}
function typedTupleIdentity(row, columns) {
	return JSON.stringify(columns.map((column) => [column, ...typedScalarIdentity(row[column])]));
}
var init_chunk_B5R3F624 = __esmMin((() => {}));
//#endregion
//#region node_modules/jena-js/dist/chunk-MKNCZ6G3.js
function assertOrderedAdjacencyBudget(codeCount) {
	const edgeCount = codeCount * codeCount;
	if (codeCount > ORDERED_MAX_CODE_COUNT || edgeCount > ORDERED_MAX_EDGE_COUNT) throw new Error(`Ordered network analysis descriptive SVD budget allows at most ${ORDERED_MAX_CODE_COUNT} codes (${ORDERED_MAX_EDGE_COUNT} directed edges); got ${codeCount} codes (${edgeCount} directed edges). The verified Yu contract uses ${ORDERED_VERIFIED_CODE_COUNT} codes, while 16/20-code probes are outside this safe bound.`);
	return edgeCount;
}
function assertOrderedSvdBudget(unitCount, edgeCount) {
	const edgeSquared = edgeCount * edgeCount;
	const estimatedWork = unitCount * edgeSquared + edgeSquared * edgeCount;
	if (estimatedWork > ORDERED_MAX_SVD_WORK_UNITS) throw new Error(`Ordered descriptive SVD work budget exceeded: units=${unitCount}, edges=${edgeCount}, estimated work=${estimatedWork} (units\xD7E\xB2+E\xB3), limit=${ORDERED_MAX_SVD_WORK_UNITS}.`);
	const estimatedMatrixBytes = FLOAT64_BYTES * (3 * edgeSquared + 2 * unitCount * edgeCount);
	if (estimatedMatrixBytes > ORDERED_MAX_SVD_MATRIX_BYTES) throw new Error(`Ordered descriptive SVD matrix budget exceeded: units=${unitCount}, edges=${edgeCount}, estimated bytes=${estimatedMatrixBytes} (8\xD7(3\xD7E\xB2+2\xD7units\xD7E)), limit=${ORDERED_MAX_SVD_MATRIX_BYTES}.`);
}
function isGeneratedOrderedHeader(column, codes, codeSet) {
	for (const response of codes) {
		const suffix = ` & ${response}`;
		if (column.endsWith(suffix) && codeSet.has(column.slice(0, -suffix.length))) return true;
	}
	return false;
}
function assertUniqueOrderedHeaders(codes) {
	const generatedHeaders = /* @__PURE__ */ new Set();
	for (const response of codes) for (const ground of codes) {
		const header = `${ground} & ${response}`;
		if (generatedHeaders.has(header)) throw new Error("Ordered adjacency headers collide; use unambiguous code labels so every \"<ground> & <response>\" header is unique.");
		generatedHeaders.add(header);
	}
}
function validateOrderedColumnNamespace(namespaces) {
	const nonCodeNamespaces = [
		["units", namespaces.units],
		["conversation", namespaces.conversation],
		["metadata", namespaces.metadata ?? []]
	];
	const declaredNamespaces = [...nonCodeNamespaces, ["codes", namespaces.codes]];
	const codeSet = /* @__PURE__ */ new Set();
	for (const code of namespaces.codes) {
		codeSet.add(code);
		if (ORDERED_RESERVED_OUTPUT_COLUMNS.has(code)) throw new Error(`Ordered input column "${code}" collides with reserved output column "${code}".`);
	}
	for (const [role, columns] of nonCodeNamespaces) for (const column of columns) {
		if (codeSet.has(column)) throw new Error(`Ordered code column "${column}" cannot also belong to the ${role} namespace; code and analytic identity/metadata roles must use distinct input columns.`);
		if (ORDERED_RESERVED_OUTPUT_COLUMNS.has(column)) throw new Error(`Ordered input column "${column}" collides with reserved output column "${column}".`);
	}
	const collisionNamespaces = [...declaredNamespaces, ["reserved output", [...ORDERED_RESERVED_OUTPUT_COLUMNS]]];
	for (const [namespace, columns] of collisionNamespaces) for (const column of columns) if (isGeneratedOrderedHeader(column, namespaces.codes, codeSet)) throw new Error(`Ordered adjacency header "${column}" collides with ${namespace} column "${column}"; rename the input column or code label.`);
	assertUniqueOrderedHeaders(namespaces.codes);
}
function isWindowSize(value) {
	return value === Number.POSITIVE_INFINITY || Number.isInteger(value) && value >= 0;
}
function firstDuplicate(values) {
	const seen = /* @__PURE__ */ new Set();
	for (const value of values) {
		if (seen.has(value)) return value;
		seen.add(value);
	}
}
function validateMask(mask, codeCount, ordered = false) {
	if (!Array.isArray(mask) || mask.length !== codeCount) throw new Error(`mask must be a ${codeCount}x${codeCount} matrix matching codes.length; got ${Array.isArray(mask) ? mask.length : typeof mask} rows.`);
	for (let row = 0; row < mask.length; row += 1) {
		const maskRow = mask[row];
		if (!Array.isArray(maskRow) || maskRow.length !== codeCount) throw new Error(`mask row ${row} must have ${codeCount} columns matching codes.length; got ${Array.isArray(maskRow) ? maskRow.length : typeof maskRow}.`);
		for (let col = 0; col < maskRow.length; col += 1) {
			const value = maskRow[col];
			if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`mask[${row}][${col}] must be a finite number; got ${String(value)}.`);
			if (ordered && value < 0) throw new Error(`Ordered network analysis mask[${row}][${col}] must be non-negative; got ${String(value)}.`);
		}
	}
}
function validateAccumulateOptions(options, { requireRows = true } = {}) {
	if (requireRows && (!Array.isArray(options.rows) || options.rows.length === 0)) throw new Error("rows is empty; provide at least one coded data row.");
	if (!Array.isArray(options.codes) || options.codes.length < 2) throw new Error(`codes must list at least 2 code columns to model co-occurrences; got ${Array.isArray(options.codes) ? options.codes.length : typeof options.codes}.`);
	const duplicateCode = firstDuplicate(options.codes);
	if (duplicateCode !== void 0) throw new Error(`codes must contain unique column labels; duplicate "${duplicateCode}".`);
	if (options.networkType !== void 0 && !NETWORK_TYPES.has(options.networkType)) throw new Error(`networkType must be one of ${[...NETWORK_TYPES].join(", ")}; got "${String(options.networkType)}".`);
	if (options.networkType === "ordered") {
		assertOrderedAdjacencyBudget(options.codes.length);
		validateOrderedColumnNamespace({
			codes: options.codes,
			units: options.units,
			conversation: options.conversation,
			...options.metadata ? { metadata: options.metadata } : {}
		});
	}
	if (options.model !== void 0 && !MODELS.has(options.model)) throw new Error(`model must be one of ${[...MODELS].join(", ")}; got "${String(options.model)}".`);
	if (options.window !== void 0 && !WINDOWS.has(options.window)) throw new Error(`window must be one of ${[...WINDOWS].join(", ")}; got "${String(options.window)}".`);
	if (options.weightBy !== void 0 && typeof options.weightBy !== "function" && options.weightBy !== "binary" && options.weightBy !== "sum") throw new Error(`weightBy must be "binary", "sum", or a function; got "${String(options.weightBy)}".`);
	if (options.windowSizeBack !== void 0 && (typeof options.windowSizeBack !== "number" || !isWindowSize(options.windowSizeBack))) throw new Error(`windowSizeBack must be a non-negative integer or Infinity; got ${String(options.windowSizeBack)}.`);
	if (options.windowSizeForward !== void 0 && (typeof options.windowSizeForward !== "number" || !isWindowSize(options.windowSizeForward))) throw new Error(`windowSizeForward must be a non-negative integer or Infinity; got ${String(options.windowSizeForward)}.`);
	if (options.mask !== void 0) validateMask(options.mask, options.codes.length, options.networkType === "ordered");
	if (options.unitsUsed !== void 0 && (!Array.isArray(options.unitsUsed) || options.unitsUsed.length === 0)) throw new Error("unitsUsed must be a non-empty array of unit labels when provided; omit it to keep every unit.");
	if (options.networkType === "ordered") {
		const model = options.model ?? "EndPoint";
		if (model !== "EndPoint") throw new Error(`Ordered network analysis requires model "EndPoint"; got "${model}".`);
		const window = options.window ?? "MovingStanzaWindow";
		if (window !== "MovingStanzaWindow") throw new Error(`Ordered network analysis requires window "MovingStanzaWindow"; got "${window}".`);
		const windowSizeBack = options.windowSizeBack ?? 1;
		if (windowSizeBack !== Number.POSITIVE_INFINITY && (!Number.isInteger(windowSizeBack) || windowSizeBack < 1)) throw new Error(`Ordered network analysis requires windowSizeBack to be an integer >= 1 or Infinity; got ${String(windowSizeBack)}.`);
		const windowSizeForward = options.windowSizeForward ?? 0;
		if (windowSizeForward !== 0) throw new Error(`Ordered network analysis only supports backward windows; windowSizeForward must be 0; got ${String(windowSizeForward)}.`);
		if (options.weightBy !== void 0 && options.weightBy !== "sum") {
			const received = typeof options.weightBy === "function" ? "function" : `"${options.weightBy}"`;
			throw new Error(`Ordered network analysis preserves raw code counts and requires weightBy "sum"; got ${received}.`);
		}
	}
}
function validateMakeSetOptions(options) {
	if (options.dimensions !== void 0 && (!Number.isInteger(options.dimensions) || options.dimensions < 1)) throw new Error(`dimensions must be an integer >= 1; got ${String(options.dimensions)}. (Values above the available rotated dimensions are clamped.)`);
	if (options.rotation !== void 0 && !ROTATION_METHODS.has(options.rotation.method)) throw new Error(`rotation.method must be one of ${[...ROTATION_METHODS].join(", ")}; got "${String(options.rotation.method)}".`);
	if (options.nodePositionMethod !== void 0 && !NODE_POSITION_METHODS.has(options.nodePositionMethod)) throw new Error(`nodePositionMethod must be one of ${[...NODE_POSITION_METHODS].join(", ")}; got "${String(options.nodePositionMethod)}".`);
}
function formatWeightBy(weightBy) {
	return typeof weightBy === "function" ? "function" : `"${weightBy}"`;
}
function orderedMetadataColumns(enadata) {
	if (!Array.isArray(enadata.metaData)) return [];
	const structuralColumns = /* @__PURE__ */ new Set([
		...enadata.units,
		...enadata.conversation,
		"ENA_UNIT",
		"TRAJ_UNIT"
	]);
	const metadata = /* @__PURE__ */ new Set();
	for (const row of enadata.metaData) {
		if (!row || typeof row !== "object" || Array.isArray(row)) continue;
		for (const column of Object.keys(row)) if (!structuralColumns.has(column)) metadata.add(column);
	}
	return [...metadata];
}
function validateExplicitStandardENADataSchema(enadata) {
	if (!Array.isArray(enadata.codes) || enadata.codes.length < 2) throw new Error("Explicit standard ENAData codes must contain at least two unique labels.");
	const duplicateCode = firstDuplicate(enadata.codes);
	if (duplicateCode !== void 0) throw new Error(`Explicit standard ENAData codes must be unique; duplicate "${duplicateCode}".`);
	const expectedKey = adjacencyKey(enadata.codes);
	const expectedWidth = expectedKey.length;
	if (!Array.isArray(enadata.codeColumns) || enadata.codeColumns.length !== expectedWidth) throw new Error(`Explicit standard ENAData codeColumns must contain ${expectedWidth} upper-triangle headers for ${enadata.codes.length} codes; got ${Array.isArray(enadata.codeColumns) ? enadata.codeColumns.length : typeof enadata.codeColumns}. Omit networkType only for legacy externally constructed directed data.`);
	for (let index = 0; index < expectedWidth; index += 1) {
		const expected = expectedKey[index];
		if (enadata.codeColumns[index] !== expected?.name) throw new Error(`Explicit standard ENAData codeColumns entry ${index} must be "${String(expected?.name)}"; got "${String(enadata.codeColumns[index])}".`);
	}
	if (!Array.isArray(enadata.adjacencyKey) || enadata.adjacencyKey.length !== expectedWidth) throw new Error(`Explicit standard ENAData adjacencyKey must contain ${expectedWidth} upper-triangle entries.`);
	for (let index = 0; index < expectedWidth; index += 1) {
		const actual = enadata.adjacencyKey[index];
		const expected = expectedKey[index];
		if (!actual || !expected || actual.source !== expected.source || actual.target !== expected.target || actual.name !== expected.name || actual.sourceIndex !== expected.sourceIndex || actual.targetIndex !== expected.targetIndex) throw new Error(`Explicit standard ENAData adjacencyKey entry ${index} does not match the required upper-triangle key.`);
	}
	if (!Array.isArray(enadata.connectionMatrix)) throw new Error("Explicit standard ENAData connectionMatrix must be an array of undirected rows.");
	if (!Array.isArray(enadata.connectionCounts)) throw new Error("Explicit standard ENAData connectionCounts must be an array of undirected count rows.");
	if (!Array.isArray(enadata.unitLabels)) throw new Error("Explicit standard ENAData unitLabels must be an array.");
	if (enadata.connectionMatrix.length !== enadata.connectionCounts.length || enadata.connectionMatrix.length !== enadata.unitLabels.length) throw new Error(`Explicit standard ENAData row counts must agree: connectionMatrix has ${enadata.connectionMatrix.length} rows, connectionCounts has ${enadata.connectionCounts.length}, and unitLabels has ${enadata.unitLabels.length}.`);
	for (let rowIndex = 0; rowIndex < enadata.connectionMatrix.length; rowIndex += 1) {
		const row = enadata.connectionMatrix[rowIndex];
		if (!Array.isArray(row) || row.length !== expectedWidth) throw new Error(`Explicit standard ENAData connectionMatrix row ${rowIndex} must contain ${expectedWidth} upper-triangle cells; got ${Array.isArray(row) ? row.length : typeof row}.`);
		for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
			const value = row[columnIndex];
			if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Explicit standard ENAData connectionMatrix[${rowIndex}][${columnIndex}] must be a finite number; got ${String(value)}.`);
		}
	}
	for (let rowIndex = 0; rowIndex < enadata.connectionCounts.length; rowIndex += 1) {
		const countRow = enadata.connectionCounts[rowIndex];
		if (!countRow || typeof countRow !== "object" || Array.isArray(countRow)) throw new Error(`Explicit standard ENAData connectionCounts row ${rowIndex} must be an object.`);
		for (let columnIndex = 0; columnIndex < expectedKey.length; columnIndex += 1) {
			const column = expectedKey[columnIndex].name;
			if (!Object.prototype.hasOwnProperty.call(countRow, column)) throw new Error(`Explicit standard ENAData connectionCounts row ${rowIndex} is missing upper-triangle column "${column}".`);
			const countValue = countRow[column];
			if (typeof countValue !== "number" || !Number.isFinite(countValue)) throw new Error(`Explicit standard ENAData connectionCounts[${rowIndex}]["${column}"] must be a finite number; got ${String(countValue)}.`);
			if (countValue !== enadata.connectionMatrix[rowIndex]?.[columnIndex]) throw new Error(`Explicit standard ENAData connectionCounts[${rowIndex}]["${column}"] does not match connectionMatrix[${rowIndex}][${columnIndex}].`);
		}
	}
}
function validateENADataNetworkContract(enadata) {
	if (enadata.networkType !== void 0 && !NETWORK_TYPES.has(enadata.networkType)) throw new Error(`ENAData networkType must be one of ${[...NETWORK_TYPES].join(", ")}; got "${String(enadata.networkType)}".`);
	if (!MODELS.has(enadata.modelType)) throw new Error(`ENAData modelType must be one of ${[...MODELS].join(", ")}; got "${String(enadata.modelType)}".`);
	if (!enadata.functionParams || typeof enadata.functionParams !== "object") throw new Error("ENAData functionParams must be an object.");
	if (!MODELS.has(enadata.functionParams.model)) throw new Error(`ENAData functionParams.model must be one of ${[...MODELS].join(", ")}; got "${String(enadata.functionParams.model)}".`);
	if (enadata.modelType !== enadata.functionParams.model) throw new Error(`ENAData modelType "${enadata.modelType}" does not match functionParams.model "${enadata.functionParams.model}".`);
	const paramsNetworkType = enadata.functionParams.networkType;
	if (paramsNetworkType !== void 0 && !NETWORK_TYPES.has(paramsNetworkType)) throw new Error(`ENAData functionParams.networkType must be one of ${[...NETWORK_TYPES].join(", ")} when provided; got "${String(paramsNetworkType)}".`);
	const dataNetworkType = enadata.networkType ?? "standard";
	const normalizedParamsNetworkType = paramsNetworkType ?? "standard";
	if (dataNetworkType !== normalizedParamsNetworkType) throw new Error(`ENAData networkType "${dataNetworkType}" does not match functionParams.networkType "${normalizedParamsNetworkType}".`);
	if (dataNetworkType !== "ordered") {
		if (enadata.networkType === "standard") validateExplicitStandardENADataSchema(enadata);
		return;
	}
	if (enadata.modelType !== "EndPoint" || enadata.functionParams.model !== "EndPoint") throw new Error("Ordered ENAData requires modelType and functionParams.model to be \"EndPoint\".");
	if (enadata.functionParams.window !== "MovingStanzaWindow") throw new Error(`Ordered ENAData requires functionParams.window "MovingStanzaWindow"; got "${String(enadata.functionParams.window)}".`);
	const back = enadata.functionParams.windowSizeBack;
	if (back !== Number.POSITIVE_INFINITY && (!Number.isInteger(back) || back < 1)) throw new Error(`Ordered ENAData requires functionParams.windowSizeBack to be an integer >= 1 or Infinity; got ${String(back)}.`);
	if (enadata.functionParams.windowSizeForward !== 0) throw new Error(`Ordered ENAData requires functionParams.windowSizeForward 0; got ${String(enadata.functionParams.windowSizeForward)}.`);
	if (enadata.functionParams.weightBy !== "sum") throw new Error(`Ordered ENAData requires functionParams.weightBy "sum"; got ${formatWeightBy(enadata.functionParams.weightBy)}.`);
	if (!Array.isArray(enadata.codes) || enadata.codes.length < 2) throw new Error("Ordered ENAData codes must contain at least two unique labels.");
	const duplicateCode = firstDuplicate(enadata.codes);
	if (duplicateCode !== void 0) throw new Error(`Ordered ENAData codes must be unique; duplicate "${duplicateCode}".`);
	assertOrderedAdjacencyBudget(enadata.codes.length);
	validateOrderedColumnNamespace({
		codes: enadata.codes,
		units: enadata.units,
		conversation: enadata.conversation,
		metadata: orderedMetadataColumns(enadata)
	});
	const expectedKey = orderedAdjacencyKey(enadata.codes);
	const expectedWidth = expectedKey.length;
	const expectedHeaders = expectedKey.map((entry) => entry.name);
	if (new Set(expectedHeaders).size !== expectedHeaders.length) throw new Error("Ordered ENAData adjacency headers collide; use unambiguous code labels.");
	if (!Array.isArray(enadata.codeColumns) || enadata.codeColumns.length !== expectedWidth) throw new Error(`Ordered ENAData codeColumns must contain ${expectedWidth} column-major directed headers for ${enadata.codes.length} codes; got ${Array.isArray(enadata.codeColumns) ? enadata.codeColumns.length : typeof enadata.codeColumns}.`);
	for (let index = 0; index < expectedWidth; index += 1) if (enadata.codeColumns[index] !== expectedHeaders[index]) throw new Error(`Ordered ENAData codeColumns entry ${index} must be "${expectedHeaders[index]}"; got "${String(enadata.codeColumns[index])}".`);
	if (!Array.isArray(enadata.adjacencyKey) || enadata.adjacencyKey.length !== expectedWidth) throw new Error(`Ordered ENAData adjacencyKey must contain ${expectedWidth} column-major entries; got ${Array.isArray(enadata.adjacencyKey) ? enadata.adjacencyKey.length : typeof enadata.adjacencyKey}.`);
	for (let index = 0; index < expectedWidth; index += 1) {
		const actual = enadata.adjacencyKey[index];
		const expected = expectedKey[index];
		if (!actual || !expected || actual.source !== expected.source || actual.target !== expected.target || actual.name !== expected.name || actual.sourceIndex !== expected.sourceIndex || actual.targetIndex !== expected.targetIndex) throw new Error(`Ordered ENAData adjacencyKey entry ${index} does not match the required column-major ground-to-response key.`);
	}
	if (!Array.isArray(enadata.connectionMatrix)) throw new Error("Ordered ENAData connectionMatrix must be an array of directed rows.");
	for (let rowIndex = 0; rowIndex < enadata.connectionMatrix.length; rowIndex += 1) {
		const row = enadata.connectionMatrix[rowIndex];
		if (!Array.isArray(row) || row.length !== expectedWidth) throw new Error(`Ordered ENAData connectionMatrix row ${rowIndex} must contain ${expectedWidth} directed cells; got ${Array.isArray(row) ? row.length : typeof row}.`);
		for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
			const value = row[columnIndex];
			if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Ordered ENAData connectionMatrix[${rowIndex}][${columnIndex}] must be a finite number; got ${String(value)}.`);
			if (value < 0) throw new Error(`Ordered ENAData connectionMatrix[${rowIndex}][${columnIndex}] must be a finite non-negative number; got ${String(value)}.`);
		}
	}
	if (!Array.isArray(enadata.connectionCounts)) throw new Error("Ordered ENAData connectionCounts must be an array of directed count rows.");
	if (!Array.isArray(enadata.unitLabels)) throw new Error("Ordered ENAData unitLabels must be an array.");
	if (enadata.connectionMatrix.length !== enadata.connectionCounts.length || enadata.connectionMatrix.length !== enadata.unitLabels.length) throw new Error(`Ordered ENAData row counts must agree: connectionMatrix has ${enadata.connectionMatrix.length} rows, connectionCounts has ${enadata.connectionCounts.length}, and unitLabels has ${enadata.unitLabels.length}.`);
	for (let rowIndex = 0; rowIndex < enadata.connectionCounts.length; rowIndex += 1) {
		const countRow = enadata.connectionCounts[rowIndex];
		if (!countRow || typeof countRow !== "object" || Array.isArray(countRow)) throw new Error(`Ordered ENAData connectionCounts row ${rowIndex} must be an object.`);
		for (let columnIndex = 0; columnIndex < expectedHeaders.length; columnIndex += 1) {
			const column = expectedHeaders[columnIndex];
			if (!Object.prototype.hasOwnProperty.call(countRow, column)) throw new Error(`Ordered ENAData connectionCounts row ${rowIndex} is missing directed column "${column}".`);
			const countValue = countRow[column];
			if (typeof countValue !== "number" || !Number.isFinite(countValue)) throw new Error(`Ordered ENAData connectionCounts[${rowIndex}]["${column}"] must be a finite number; got ${String(countValue)}.`);
			if (countValue < 0) throw new Error(`Ordered ENAData connectionCounts[${rowIndex}]["${column}"] must be a finite non-negative number; got ${String(countValue)}.`);
			if (countValue !== enadata.connectionMatrix[rowIndex]?.[columnIndex]) throw new Error(`Ordered ENAData connectionCounts[${rowIndex}]["${column}"] does not match connectionMatrix[${rowIndex}][${columnIndex}].`);
		}
	}
}
function normalizeModel(model) {
	return model ?? "EndPoint";
}
function normalizeNetworkType(networkType) {
	return networkType ?? "standard";
}
function normalizeWindow(window) {
	return window ?? "MovingStanzaWindow";
}
function normalizeWeightBy(weightBy, networkType) {
	return weightBy ?? (networkType === "ordered" ? "sum" : "binary");
}
function numeric(row, column) {
	const raw = row[column];
	const value = typeof raw === "number" ? raw : Number(raw);
	return Number.isFinite(value) ? value : 0;
}
function zeros(length) {
	return Array.from({ length }, () => 0);
}
function addVectors(left, right) {
	const width = Math.max(left.length, right.length);
	return Array.from({ length: width }, (_unused, index) => (left[index] ?? 0) + (right[index] ?? 0));
}
function subtractVectors(left, right) {
	const width = Math.max(left.length, right.length);
	return Array.from({ length: width }, (_unused, index) => (left[index] ?? 0) - (right[index] ?? 0));
}
function sumCodeVectors(vectors, width) {
	if (vectors.length === 0) return zeros(width);
	return sumColumns(vectors);
}
function orderedRawCodeValue(row, code, rowIndex) {
	const raw = row[code];
	const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
	if (!Number.isFinite(value) || value < 0) throw new Error(`Ordered network analysis raw code value at row ${rowIndex}, column "${code}" must be a finite non-negative number or numeric string; got ${String(raw)}.`);
	return value;
}
function codeValues(row, codes, networkType, rowIndex) {
	return networkType === "ordered" ? codes.map((code) => orderedRawCodeValue(row, code, rowIndex)) : codes.map((code) => numeric(row, code));
}
function orderedIdentityValueKind(value) {
	if (typeof value === "number" && !Number.isFinite(value)) return String(value);
	return typeof value;
}
function assertOrderedIdentityColumns(row, rowIndex, kind, columns) {
	for (const column of columns) {
		const value = row[column];
		if (!(value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))) throw new Error(`Ordered network analysis ${kind} identity value at row ${rowIndex}, column "${column}" must be a string, finite number, boolean, or null; got ${orderedIdentityValueKind(value)}.`);
	}
}
function assertOrderedIdentityValues(internals, row, rowIndex) {
	if (internals.networkType !== "ordered") return;
	assertOrderedIdentityColumns(row, rowIndex, "unit", internals.units);
	assertOrderedIdentityColumns(row, rowIndex, "conversation", internals.conversation);
	assertOrderedIdentityColumns(row, rowIndex, "metadata", internals.metadata);
}
function assertOrderedRawKeysDoNotCollide(internals, row, rowIndex) {
	if (internals.networkType !== "ordered") return;
	for (const header of internals.codeColumns) if (Object.prototype.hasOwnProperty.call(row, header)) throw new Error(`Ordered network analysis raw row ${rowIndex} key "${header}" collides with generated edge header "${header}".`);
}
function makeUnitRow(row, units) {
	return {
		...row,
		ENA_UNIT: mergeColumns(row, units)
	};
}
function unitMapKey(internals, row) {
	return internals.networkType === "ordered" ? typedTupleIdentity(row, internals.units) : String(row.ENA_UNIT ?? mergeColumns(row, internals.units));
}
function assertOrderedUnitDisplayIsUnique(internals, row) {
	if (internals.networkType !== "ordered") return;
	const displayLabel = String(row.ENA_UNIT ?? mergeColumns(row, internals.units));
	const identity = typedTupleIdentity(row, internals.units);
	const previousIdentity = internals.orderedUnitDisplayIdentities.get(displayLabel);
	if (previousIdentity !== void 0 && previousIdentity !== identity) throw new Error(`Ordered network analysis unit label collision: distinct typed unit tuples format as "${displayLabel}"; use unambiguous unit values or columns.`);
	internals.orderedUnitDisplayIdentities.set(displayLabel, identity);
}
function flattenMask(mask, networkType) {
	const flat = [];
	if (networkType === "ordered") {
		for (let response = 0; response < mask.length; response += 1) for (let ground = 0; ground < mask.length; ground += 1) flat.push(mask[ground]?.[response] ?? 1);
		return flat;
	}
	for (let target = 1; target < mask.length; target += 1) for (let source = 0; source < target; source += 1) flat.push(mask[source]?.[target] ?? 1);
	return flat;
}
function applyMaskToCoOccurrence(values, flatMask) {
	if (!flatMask) return values;
	return values.map((value, index) => value * (flatMask[index] ?? 1));
}
function applyWeight(values, weightBy) {
	if (weightBy === "binary" || weightBy === "sum") return values;
	return values.map((value) => weightBy([value]));
}
function coOccurrenceFromSums(total, subtract, binary) {
	const co = subtract ? subtractVectors(vectorToUpperTriangle(total), vectorToUpperTriangle(subtract)) : vectorToUpperTriangle(total);
	return binary ? co.map((value) => value > 0 ? 1 : 0) : co;
}
function finalizeCoOccurrence(values, internals) {
	const finalized = applyWeight(internals.networkType === "ordered" ? values : applyMaskToCoOccurrence(values, internals.mask), internals.weightBy);
	if (internals.networkType === "ordered") {
		const codeCount = internals.codes.length;
		for (let edgeIndex = 0; edgeIndex < finalized.length; edgeIndex += 1) {
			const value = finalized[edgeIndex];
			const groundIndex = edgeIndex % codeCount;
			const responseIndex = Math.floor(edgeIndex / codeCount);
			const ground = internals.codes[groundIndex] ?? String(groundIndex);
			const response = internals.codes[responseIndex] ?? String(responseIndex);
			if (!Number.isFinite(value)) throw new Error(`Ordered network analysis derived a non-finite connection at edge index ${edgeIndex} (${ground} -> ${response}); got ${String(value)}. Reduce raw code magnitudes so every connection product remains finite.`);
		}
	}
	return finalized;
}
function rowWithCoOccurrences(base, co, codeColumns) {
	return {
		...base,
		...Object.fromEntries(codeColumns.map((column, index) => [column, co[index] ?? 0]))
	};
}
function ensureMetadata(internals, row, sequence) {
	if (!internals.includeMeta) return;
	const unitKey = unitMapKey(internals, row);
	let state = internals.metadataStates.get(unitKey);
	if (!state) {
		state = {
			row: Object.fromEntries(["ENA_UNIT", ...internals.units].map((column) => [column, row[column] ?? null])),
			values: /* @__PURE__ */ new Map(),
			unstable: /* @__PURE__ */ new Set(),
			sequence
		};
		for (const column of internals.metadata) state.values.set(column, row[column] ?? null);
		internals.metadataStates.set(unitKey, state);
		internals.metadataOrder.push(unitKey);
		return;
	}
	for (const column of internals.metadata) {
		const previous = state.values.get(column);
		const current = row[column] ?? null;
		if (String(previous ?? "") !== String(current ?? "")) state.unstable.add(column);
	}
}
function ensureEndpointCount(internals, row, sequence) {
	const key = unitMapKey(internals, row);
	const displayLabel = String(row.ENA_UNIT ?? mergeColumns(row, internals.units));
	let accumulator = internals.endpointCounts.get(key);
	if (!accumulator) {
		accumulator = {
			row: {
				...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
				ENA_UNIT: displayLabel
			},
			sums: zeros(internals.codeColumns.length),
			...internals.networkType === "ordered" ? { orderedPartials: Array.from({ length: internals.codeColumns.length }, () => []) } : {},
			sequence
		};
		internals.endpointCounts.set(key, accumulator);
		internals.endpointOrder.push(key);
	}
	return accumulator;
}
function ensureStepCount(internals, row, sequence) {
	const key = mergeColumns(row, [...internals.units, ...internals.conversation]);
	let accumulator = internals.stepCounts.get(key);
	if (!accumulator) {
		accumulator = {
			row: {
				...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
				...Object.fromEntries(internals.conversation.map((column) => [column, row[column] ?? null])),
				ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, internals.units),
				TRAJ_UNIT: mergeColumns(row, internals.conversation)
			},
			sums: zeros(internals.codeColumns.length),
			...internals.networkType === "ordered" ? { orderedPartials: Array.from({ length: internals.codeColumns.length }, () => []) } : {},
			sequence
		};
		internals.stepCounts.set(key, accumulator);
		internals.stepOrder.push(key);
	}
	return accumulator;
}
function addToAccumulator(accumulator, values, internals) {
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index] ?? 0;
		if (internals.networkType === "ordered") {
			const partials = accumulator.orderedPartials?.[index];
			if (!partials) throw new Error(`Ordered network analysis internal accumulator is missing edge index ${index}.`);
			addOrderedRunningPartial(partials, value);
			const total = orderedExpansionTotal(partials);
			if (!Number.isFinite(total)) {
				const codeCount = internals.codes.length;
				const groundIndex = index % codeCount;
				const responseIndex = Math.floor(index / codeCount);
				const ground = internals.codes[groundIndex] ?? String(groundIndex);
				const response = internals.codes[responseIndex] ?? String(responseIndex);
				throw new Error(`Ordered network analysis unit aggregation overflow at edge index ${index} (${ground} -> ${response}); got ${String(total)}. Reduce row count or raw code magnitudes.`);
			}
			accumulator.sums[index] = total;
		} else accumulator.sums[index] = (accumulator.sums[index] ?? 0) + value;
	}
}
function registerCountAccumulator(internals, row, sequence) {
	const unit = String(row.ENA_UNIT ?? "");
	if (internals.unitFilter && !internals.unitFilter.has(unit)) return;
	if (internals.model === "EndPoint") ensureEndpointCount(internals, row, sequence);
	else ensureStepCount(internals, row, sequence);
}
function consumeRowConnection(internals, index, row) {
	if (internals.materialization === "full") internals.rowConnectionRows.push({
		index,
		row
	});
	const unit = String(row.ENA_UNIT ?? "");
	if (internals.unitFilter && !internals.unitFilter.has(unit)) return;
	const values = internals.codeColumns.map((column) => numeric(row, column));
	if (internals.model === "EndPoint") addToAccumulator(ensureEndpointCount(internals, row, index), values, internals);
	else addToAccumulator(ensureStepCount(internals, row, index), values, internals);
}
function makeNoForwardCoOccurrence(state, entry, internals) {
	const binary = internals.weightBy === "binary";
	const back = internals.windowSizeBack;
	if (back === 0 || back === 1) return coOccurrenceFromSums(entry.codeValues, void 0, binary);
	if (!Number.isFinite(back)) {
		const previous2 = state.noForwardRunningSum;
		const total = addVectors(previous2, entry.codeValues);
		state.noForwardRunningSum = total;
		return coOccurrenceFromSums(total, previous2, binary);
	}
	const previous = sumCodeVectors(state.noForwardHistory.slice(-Math.max(0, back - 1)), internals.codes.length);
	state.noForwardHistory.push(entry.codeValues);
	while (state.noForwardHistory.length > back - 1) state.noForwardHistory.shift();
	return coOccurrenceFromSums(addVectors(previous, entry.codeValues), previous, binary);
}
function assertOrderedProductDidNotUnderflow(left, right, product, edgeIndex, ground, response, contribution) {
	if (left > 0 && right > 0 && product === 0) throw new Error(`Ordered network analysis numeric underflow at edge index ${edgeIndex} (${ground} -> ${response}): positive ${contribution} operands ${String(left)} and ${String(right)} produced 0.`);
}
function orderedHalfProduct(left, right) {
	return Math.abs(left) >= Math.abs(right) ? left * .5 * right : left * (right * .5);
}
function orderedFractionallyMaskedLaggedProduct(priorPartials, currentResponse, maskWeight) {
	const scaledPartials = [];
	for (const partial of priorPartials) addOrderedRunningPartial(scaledPartials, Math.abs(partial) >= Math.abs(currentResponse) ? partial * maskWeight * currentResponse : partial * (currentResponse * maskWeight));
	return orderedExpansionTotal(scaledPartials);
}
function orderedFractionallyMaskedSameRowProduct(currentGround, currentResponse, maskWeight) {
	return Math.abs(currentGround) >= Math.abs(currentResponse) ? orderedHalfProduct(currentGround * maskWeight, currentResponse) : orderedHalfProduct(currentGround, currentResponse * maskWeight);
}
function orderedConnections(prior, priorPartials, response, codes, flatMask) {
	const width = response.length;
	const connections = zeros(width * width);
	for (let responseIndex = 0; responseIndex < width; responseIndex += 1) for (let groundIndex = 0; groundIndex < width; groundIndex += 1) {
		const edgeIndex = responseIndex * width + groundIndex;
		const maskWeight = flatMask?.[edgeIndex] ?? 1;
		if (maskWeight === 0) continue;
		const ground = codes[groundIndex] ?? String(groundIndex);
		const responseCode = codes[responseIndex] ?? String(responseIndex);
		const priorGround = prior[groundIndex] ?? 0;
		const currentResponse = response[responseIndex] ?? 0;
		let lagged = priorGround * currentResponse;
		if (currentResponse === 0) lagged = 0;
		else if (!Number.isFinite(priorGround) && currentResponse < 1) {
			const scaledPartials = [];
			for (const partial of priorPartials[groundIndex] ?? []) addOrderedRunningPartial(scaledPartials, partial * currentResponse);
			lagged = orderedExpansionTotal(scaledPartials);
		}
		assertOrderedProductDidNotUnderflow(priorGround, currentResponse, lagged, edgeIndex, ground, responseCode, "lagged");
		let sameRow = 0;
		if (groundIndex !== responseIndex) {
			const currentGround = response[groundIndex] ?? 0;
			sameRow = orderedHalfProduct(currentGround, currentResponse);
			assertOrderedProductDidNotUnderflow(currentGround, currentResponse, sameRow, edgeIndex, ground, responseCode, "same-row");
		}
		const unmaskedConnection = lagged + sameRow;
		let connection;
		if (Number.isFinite(unmaskedConnection) || maskWeight >= 1) connection = unmaskedConnection * maskWeight;
		else {
			const maskedLagged = Number.isFinite(lagged) ? lagged * maskWeight : orderedFractionallyMaskedLaggedProduct(priorPartials[groundIndex] ?? [], currentResponse, maskWeight);
			const maskedSameRow = Number.isFinite(sameRow) ? sameRow * maskWeight : orderedFractionallyMaskedSameRowProduct(response[groundIndex] ?? 0, currentResponse, maskWeight);
			const maskedPartials = [];
			addOrderedRunningPartial(maskedPartials, maskedLagged);
			addOrderedRunningPartial(maskedPartials, maskedSameRow);
			connection = orderedExpansionTotal(maskedPartials);
		}
		if ((lagged > 0 || sameRow > 0) && maskWeight > 0 && connection === 0) throw new Error(`Ordered network analysis mask underflow at edge index ${edgeIndex} (${ground} -> ${responseCode}): positive connection ${String(unmaskedConnection)} and mask weight ${String(maskWeight)} produced 0.`);
		connections[edgeIndex] = connection;
	}
	return connections;
}
function addOrderedRunningPartial(partials, value) {
	if (value === 0) return;
	let next = value;
	let writeIndex = 0;
	for (const existingValue of partials) {
		let existing = existingValue;
		if (Math.abs(next) < Math.abs(existing)) {
			const swap = next;
			next = existing;
			existing = swap;
		}
		const high = next + existing;
		if (!Number.isFinite(high)) {
			partials[writeIndex] = existing;
			writeIndex += 1;
			continue;
		}
		const low = existing - (high - next);
		if (low !== 0) {
			partials[writeIndex] = low;
			writeIndex += 1;
		}
		next = high;
	}
	partials.length = writeIndex;
	if (next !== 0) partials.push(next);
}
function orderedExpansionTotal(partials) {
	if (partials.length === 0) return 0;
	let partialIndex = partials.length - 1;
	let high = partials[partialIndex];
	partialIndex -= 1;
	let low = 0;
	while (partialIndex >= 0) {
		const previousHigh = high;
		const next = partials[partialIndex];
		partialIndex -= 1;
		high = previousHigh + next;
		if (!Number.isFinite(high)) return high;
		low = next - (high - previousHigh);
		if (low !== 0) break;
	}
	const nextPartial = partials[partialIndex];
	if (nextPartial !== void 0 && (low < 0 && nextPartial < 0 || low > 0 && nextPartial > 0)) {
		const doubledLow = low * 2;
		const adjusted = high + doubledLow;
		if (!Number.isFinite(adjusted)) return adjusted;
		if (adjusted - high === doubledLow) high = adjusted;
	}
	return high;
}
function updateOrderedRunningSum(state, values, direction) {
	for (let index = 0; index < values.length; index += 1) addOrderedRunningPartial(state.orderedRunningPartials[index] ?? (state.orderedRunningPartials[index] = []), direction * (values[index] ?? 0));
	state.orderedRunningSum = state.orderedRunningPartials.map(orderedExpansionTotal);
}
function makeOrderedNoForwardConnections(state, entry, internals) {
	const priorLimit = Number.isFinite(internals.windowSizeBack) ? Math.max(0, internals.windowSizeBack - 1) : Number.POSITIVE_INFINITY;
	const priorRowCount = Number.isFinite(priorLimit) ? state.orderedHistorySize : state.rowsSeen - 1;
	const connections = orderedConnections(state.orderedRunningSum, state.orderedRunningPartials, entry.codeValues, internals.codes, internals.mask);
	internals.rowWindowProvenance.push({
		responseRowIndex: entry.globalIndex,
		horizon: state.key,
		horizonIdentity: state.identity,
		previousRowIndex: state.orderedPreviousRowIndex,
		priorRowCount
	});
	state.orderedPreviousRowIndex = entry.globalIndex;
	if (Number.isFinite(priorLimit)) {
		if (priorLimit === 0) state.orderedRunningSum = zeros(internals.codes.length);
		else if (state.orderedHistorySize < priorLimit) {
			state.orderedHistory.push(entry);
			state.orderedHistorySize += 1;
			updateOrderedRunningSum(state, entry.codeValues, 1);
		} else {
			const removed = state.orderedHistory[state.orderedHistoryHead];
			if (removed) updateOrderedRunningSum(state, removed.codeValues, -1);
			state.orderedHistory[state.orderedHistoryHead] = entry;
			state.orderedHistoryHead = (state.orderedHistoryHead + 1) % priorLimit;
			updateOrderedRunningSum(state, entry.codeValues, 1);
		}
	} else updateOrderedRunningSum(state, entry.codeValues, 1);
	return connections;
}
function rowsForLocalRange(state, earliest, last) {
	return state.buffer.filter((entry) => entry.localIndex >= earliest && entry.localIndex <= last).sort((left, right) => left.localIndex - right.localIndex).map((entry) => entry.codeValues);
}
function computeWindowCoOccurrence(state, rowIndex, final, internals) {
	const rowCount = state.rowsSeen;
	const back = internals.windowSizeBack;
	const forward = internals.windowSizeForward;
	const binary = internals.weightBy === "binary";
	const infiniteBack = !Number.isFinite(back);
	const infiniteForward = !Number.isFinite(forward);
	if (!final && (infiniteForward || rowIndex + forward >= rowCount)) return void 0;
	let earliest = 0;
	let last = rowIndex;
	if (infiniteBack) earliest = 0;
	else if (back === 0) earliest = rowIndex;
	else if (rowIndex - (back - 1) >= 0) earliest = rowIndex - (back - 1);
	if (infiniteForward || rowIndex + forward >= rowCount) last = rowCount - 1;
	else if (forward > 0 && rowIndex + forward <= rowCount - 1) last = rowIndex + forward;
	const currRows = rowsForLocalRange(state, earliest, last);
	if (currRows.length !== last - earliest + 1) return void 0;
	let co = vectorToUpperTriangle(sumCodeVectors(currRows, internals.codes.length));
	const currRowCount = currRows.length;
	if (currRowCount > 0 && back > 1 && rowIndex - 1 >= 0) {
		const headRows = currRowCount - 1 - forward;
		if (headRows > 0) co = subtractVectors(co, vectorToUpperTriangle(sumCodeVectors(currRows.slice(0, headRows), internals.codes.length)));
	}
	if (currRowCount > 0 && forward > 0 && last <= rowCount - 1) {
		const tailRowsToUse = last - rowIndex;
		if (tailRowsToUse > 0) co = subtractVectors(co, vectorToUpperTriangle(sumCodeVectors(currRows.slice(-tailRowsToUse), internals.codes.length)));
	}
	return binary ? co.map((value) => value > 0 ? 1 : 0) : co;
}
function emitReadyRows(state, final, internals) {
	while (state.nextEmitLocalIndex < state.rowsSeen) {
		const entry = state.buffer.find((candidate) => candidate.localIndex === state.nextEmitLocalIndex);
		if (!entry) break;
		const co = computeWindowCoOccurrence(state, state.nextEmitLocalIndex, final, internals);
		if (!co) break;
		consumeRowConnection(internals, entry.globalIndex, rowWithCoOccurrences(entry.row, finalizeCoOccurrence(co, internals), internals.codeColumns));
		state.nextEmitLocalIndex += 1;
	}
	if (Number.isFinite(internals.windowSizeBack)) {
		const keepFrom = Math.max(0, state.nextEmitLocalIndex - Math.max(0, internals.windowSizeBack - 1));
		while (state.buffer.length > 0 && (state.buffer[0]?.localIndex ?? 0) < keepFrom) {
			state.buffer.shift();
			state.bufferOffset = keepFrom;
		}
	}
}
function getMovingConversation(internals, identityKey, displayLabel) {
	let state = internals.movingConversations.get(identityKey);
	if (!state) {
		state = {
			key: displayLabel,
			identity: identityKey,
			rowsSeen: 0,
			nextEmitLocalIndex: 0,
			bufferOffset: 0,
			buffer: [],
			noForwardHistory: [],
			noForwardRunningSum: zeros(internals.codes.length),
			orderedRunningSum: zeros(internals.codes.length),
			orderedRunningPartials: Array.from({ length: internals.codes.length }, () => []),
			orderedPreviousRowIndex: null,
			orderedHistory: [],
			orderedHistoryHead: 0,
			orderedHistorySize: 0
		};
		internals.movingConversations.set(identityKey, state);
	}
	return state;
}
function pushMovingRow(internals, row, globalIndex) {
	const displayLabel = mergeColumns(row, internals.conversation);
	const state = getMovingConversation(internals, internals.networkType === "ordered" ? typedTupleIdentity(row, internals.conversation) : displayLabel, displayLabel);
	const entry = {
		globalIndex,
		localIndex: state.rowsSeen,
		row,
		codeValues: codeValues(row, internals.codes, internals.networkType, globalIndex)
	};
	state.rowsSeen += 1;
	if (internals.windowSizeForward === 0) {
		consumeRowConnection(internals, globalIndex, rowWithCoOccurrences(row, finalizeCoOccurrence(internals.networkType === "ordered" ? makeOrderedNoForwardConnections(state, entry, internals) : makeNoForwardCoOccurrence(state, entry, internals), internals), internals.codeColumns));
		return;
	}
	state.buffer.push(entry);
	emitReadyRows(state, false, internals);
}
function pushConversationRow(internals, row, sequence) {
	const key = mergeColumns(row, [...internals.conversation, "ENA_UNIT"]);
	let aggregate = internals.conversationAggregates.get(key);
	if (!aggregate) {
		aggregate = {
			key,
			row: {
				...Object.fromEntries(internals.codes.map((code) => [code, 0])),
				...Object.fromEntries(internals.conversation.map((column) => [column, row[column] ?? null])),
				...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
				ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, internals.units)
			},
			sums: zeros(internals.codes.length),
			sequence
		};
		internals.conversationAggregates.set(key, aggregate);
		internals.conversationAggregateOrder.push(key);
	}
	for (let index = 0; index < internals.codes.length; index += 1) aggregate.sums[index] = (aggregate.sums[index] ?? 0) + numeric(row, internals.codes[index] ?? "");
}
function flushConversationWindow(internals) {
	const binary = internals.weightBy === "binary";
	for (const key of internals.conversationAggregateOrder) {
		const aggregate = internals.conversationAggregates.get(key);
		if (!aggregate) continue;
		const co = coOccurrenceFromSums(aggregate.sums, void 0, binary);
		const row = {
			...aggregate.row,
			...Object.fromEntries(internals.codes.map((code, index) => [code, aggregate.sums[index] ?? 0]))
		};
		consumeRowConnection(internals, aggregate.sequence, rowWithCoOccurrences(row, finalizeCoOccurrence(co, internals), internals.codeColumns));
	}
}
function stableMetadataColumns(internals) {
	if (!internals.includeMeta) return [];
	return internals.metadata.filter((column) => {
		for (const state of internals.metadataStates.values()) if (state.unstable.has(column)) return false;
		return true;
	});
}
function buildMetadataRows(internals, countUnitKeys) {
	const stable = stableMetadataColumns(internals);
	return internals.metadataOrder.filter((unitKey) => countUnitKeys.has(unitKey)).map((unitKey) => {
		const state = internals.metadataStates.get(unitKey);
		return {
			...state?.row ?? { ENA_UNIT: unitKey },
			...Object.fromEntries(stable.map((column) => [column, state?.values.get(column) ?? null]))
		};
	});
}
function matrixFromRows(rows, columns) {
	return rows.map((row) => columns.map((column) => numeric(row, column)));
}
function finalizedAccumulatorSums(accumulator, internals) {
	if (internals.networkType !== "ordered") return accumulator?.sums ?? zeros(internals.codeColumns.length);
	return internals.codeColumns.map((_column, edgeIndex) => {
		const value = orderedExpansionTotal(accumulator?.orderedPartials?.[edgeIndex] ?? []);
		if (!Number.isFinite(value)) {
			const codeCount = internals.codes.length;
			const groundIndex = edgeIndex % codeCount;
			const responseIndex = Math.floor(edgeIndex / codeCount);
			const ground = internals.codes[groundIndex] ?? String(groundIndex);
			const response = internals.codes[responseIndex] ?? String(responseIndex);
			throw new Error(`Ordered network analysis unit aggregation overflow at edge index ${edgeIndex} (${ground} -> ${response}); got ${String(value)}. Reduce row count or raw code magnitudes.`);
		}
		return value;
	});
}
function makeEndpointResult(internals) {
	const countRows = internals.endpointOrder.map((key) => {
		const accumulator = internals.endpointCounts.get(key);
		const sums = finalizedAccumulatorSums(accumulator, internals);
		return {
			...accumulator?.row ?? { ENA_UNIT: key },
			...Object.fromEntries(internals.codeColumns.map((column, index) => [column, sums[index] ?? 0]))
		};
	});
	const metaData = buildMetadataRows(internals, new Set(internals.endpointOrder));
	const metaByUnit = new Map(metaData.map((row) => [String(row.ENA_UNIT ?? ""), row]));
	return {
		countRows,
		metaData,
		connectionCounts: countRows.map((row) => ({
			...metaByUnit.get(String(row.ENA_UNIT ?? "")) ?? {},
			...Object.fromEntries(internals.codeColumns.map((column) => [column, row[column] ?? 0]))
		}))
	};
}
function makeTrajectoryRows(internals) {
	return internals.stepOrder.map((key) => {
		const accumulator = internals.stepCounts.get(key);
		const sums = finalizedAccumulatorSums(accumulator, internals);
		return {
			...accumulator?.row ?? {},
			...Object.fromEntries(internals.codeColumns.map((column, index) => [column, sums[index] ?? 0]))
		};
	});
}
function makeTrajectoryResult(internals) {
	const perStepRows = makeTrajectoryRows(internals);
	const countRows = [];
	if (internals.model === "SeparateTrajectory") countRows.push(...perStepRows);
	else {
		const rowsByUnit = /* @__PURE__ */ new Map();
		for (const row of perStepRows) {
			const unit = String(row.ENA_UNIT ?? "");
			const current = rowsByUnit.get(unit);
			if (current) current.push(row);
			else rowsByUnit.set(unit, [row]);
		}
		for (const groupRows of rowsByUnit.values()) {
			const running = Object.fromEntries(internals.codeColumns.map((column) => [column, 0]));
			for (const row of groupRows) {
				for (const column of internals.codeColumns) running[column] = numeric(running, column) + numeric(row, column);
				countRows.push({
					...row,
					...running
				});
			}
		}
	}
	const trajectories = countRows.map((row) => Object.fromEntries([
		...internals.units,
		"ENA_UNIT",
		...internals.conversation
	].map((column) => [column, row[column] ?? null])));
	const metaData = countRows.map((row) => Object.fromEntries([...internals.units, "ENA_UNIT"].map((column) => [column, row[column] ?? null])));
	return {
		connectionCounts: countRows.map((row) => ({
			...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
			ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, internals.units),
			...Object.fromEntries(internals.codeColumns.map((column) => [column, row[column] ?? 0]))
		})),
		metaData,
		countRows,
		trajectories
	};
}
function flushMovingWindow(internals) {
	if (internals.windowSizeForward === 0) return;
	for (const state of internals.movingConversations.values()) emitReadyRows(state, true, internals);
}
function finishInternals(internals) {
	if (internals.window === "Conversation") flushConversationWindow(internals);
	else flushMovingWindow(internals);
	const resultRows = internals.model === "EndPoint" ? makeEndpointResult(internals) : makeTrajectoryResult(internals);
	if (internals.unitFilter && resultRows.countRows.length === 0) throw new Error("unitsUsed did not match any accumulated units; check the labels against the merged unit column (units joined with \".\").");
	const connectionMatrix = matrixFromRows(resultRows.connectionCounts, internals.codeColumns);
	const unitLabels = resultRows.countRows.map((row) => internals.model === "EndPoint" ? String(row.ENA_UNIT ?? "") : `${String(row.ENA_UNIT ?? "")}::${String(row.TRAJ_UNIT ?? "")}`);
	const rowConnectionCounts = internals.materialization === "full" ? internals.rowConnectionRows.sort((left, right) => left.index - right.index).map((entry) => entry.row) : [];
	const rawRows = internals.materialization === "full" ? internals.rawRows : [];
	const result = {
		modelType: internals.model,
		codes: internals.codes,
		units: internals.units,
		conversation: internals.conversation,
		codeColumns: internals.codeColumns,
		adjacencyKey: internals.networkType === "ordered" ? orderedAdjacencyKey(internals.codes) : adjacencyKey(internals.codes),
		rawRows,
		rowConnectionCounts,
		connectionCounts: resultRows.connectionCounts,
		connectionMatrix,
		metaData: resultRows.metaData,
		unitLabels,
		functionParams: {
			model: internals.model,
			weightBy: internals.weightBy,
			window: internals.window,
			windowSizeBack: internals.reportedWindowSizeBack,
			windowSizeForward: internals.windowSizeForward,
			includeMeta: internals.includeMeta,
			...internals.unitFilter ? { unitsUsed: [...internals.unitFilter] } : {}
		}
	};
	const trajectoryRows = resultRows.trajectories;
	if (trajectoryRows) result.trajectories = trajectoryRows;
	if (internals.networkType === "ordered") {
		result.networkType = "ordered";
		result.functionParams.networkType = "ordered";
		result.rowWindowProvenance = [...internals.rowWindowProvenance];
		internals.movingConversations.clear();
		internals.conversationAggregates.clear();
	}
	return result;
}
function activeBufferedRows(internals) {
	let total = 0;
	for (const state of internals.movingConversations.values()) total += state.buffer.length + state.noForwardHistory.length + state.orderedHistorySize;
	return total;
}
function updateProgress(state, internals, expectedRows) {
	state.progress = expectedRows && expectedRows > 0 ? Math.min(.99, state.rowsSeen / expectedRows) : 0;
	state.activeConversations = internals.movingConversations.size + internals.conversationAggregates.size;
	state.activeBufferedRows = activeBufferedRows(internals);
	state.activeConversationsPeak = Math.max(state.activeConversationsPeak, state.activeConversations);
	state.activeBufferedRowsPeak = Math.max(state.activeBufferedRowsPeak, state.activeBufferedRows);
}
function makeInternals(options) {
	const networkType = normalizeNetworkType(options.networkType);
	const model = normalizeModel(options.model);
	const window = normalizeWindow(options.window);
	const weightBy = normalizeWeightBy(options.weightBy, networkType);
	const units = [...options.units];
	const conversation = [...options.conversation];
	const codes = [...options.codes];
	const metadata = [...options.metadata ?? []];
	assertNonEmptyColumns(units, "units");
	assertNonEmptyColumns(conversation, "conversation");
	assertNonEmptyColumns(codes, "codes");
	if (options.rows) assertRowsHaveColumns(options.rows, [
		...units,
		...conversation,
		...codes,
		...metadata
	]);
	return {
		networkType,
		model,
		window,
		weightBy,
		windowSizeBack: window === "Conversation" ? Number.POSITIVE_INFINITY : options.windowSizeBack ?? 1,
		reportedWindowSizeBack: options.windowSizeBack ?? 1,
		windowSizeForward: options.windowSizeForward ?? 0,
		includeMeta: options.includeMeta ?? true,
		materialization: options.materialization ?? "full",
		units,
		conversation,
		codes,
		metadata,
		codeColumns: networkType === "ordered" ? orderedAdjacencyKey(codes).map((entry) => entry.name) : stringVectorToUpperTriangle(codes),
		...options.mask ? { mask: flattenMask(options.mask, networkType) } : {},
		...options.unitsUsed ? { unitFilter: new Set(options.unitsUsed.map(String)) } : {},
		rawRows: [],
		rowConnectionRows: [],
		rowWindowProvenance: [],
		movingConversations: /* @__PURE__ */ new Map(),
		conversationAggregates: /* @__PURE__ */ new Map(),
		conversationAggregateOrder: [],
		endpointCounts: /* @__PURE__ */ new Map(),
		endpointOrder: [],
		stepCounts: /* @__PURE__ */ new Map(),
		stepOrder: [],
		metadataStates: /* @__PURE__ */ new Map(),
		metadataOrder: [],
		orderedUnitDisplayIdentities: /* @__PURE__ */ new Map(),
		rowConnectionSequence: 0
	};
}
function ingestRow(internals, row, globalIndex) {
	assertOrderedRawKeysDoNotCollide(internals, row, globalIndex);
	assertOrderedIdentityValues(internals, row, globalIndex);
	const rowWithUnit = makeUnitRow(row, internals.units);
	assertOrderedUnitDisplayIsUnique(internals, rowWithUnit);
	if (internals.materialization === "full") internals.rawRows.push(rowWithUnit);
	ensureMetadata(internals, rowWithUnit, globalIndex);
	registerCountAccumulator(internals, rowWithUnit, globalIndex);
	if (internals.window === "Conversation") pushConversationRow(internals, rowWithUnit, internals.rowConnectionSequence);
	else pushMovingRow(internals, rowWithUnit, globalIndex);
	internals.rowConnectionSequence += 1;
}
function accumulateDataChunked(options) {
	const chunkSize = options.chunkSize ?? 1e4;
	if (chunkSize <= 0 || !Number.isFinite(chunkSize)) throw new Error("chunkSize must be a positive finite number.");
	const { rows, onProgress, ...streamOptions } = options;
	onProgress?.(0);
	const stream = createAccumulationStream({
		...streamOptions,
		expectedRows: rows.length,
		...onProgress ? { onProgress } : {}
	});
	try {
		for (let index = 0; index < rows.length; index += chunkSize) stream.push(rows.slice(index, index + chunkSize));
		return stream.finish();
	} finally {
		stream.dispose();
	}
}
function makeAccumulationStreamController(resources, expectedRows) {
	const state = {
		rowsSeen: 0,
		chunksSeen: 0,
		isFinished: false,
		isDisposed: false,
		progress: 0,
		activeConversations: 0,
		activeBufferedRows: 0,
		activeConversationsPeak: 0,
		activeBufferedRowsPeak: 0
	};
	const dispose = () => {
		if (!state.isDisposed) {
			state.isFinished = true;
			state.isDisposed = true;
			state.activeConversations = 0;
			state.activeBufferedRows = 0;
		}
		resources.internals = void 0;
		resources.requiredColumns = void 0;
		resources.onProgress = void 0;
	};
	const push = (rows) => {
		if (state.isFinished) throw new Error("Cannot push rows after accumulation stream has finished.");
		const activeInternals = resources.internals;
		const columns = resources.requiredColumns;
		if (!activeInternals || !columns) {
			dispose();
			throw new Error("Cannot push rows after accumulation stream has finished.");
		}
		try {
			assertRowsHaveColumns(rows, columns);
			for (const row of rows) {
				ingestRow(activeInternals, row, state.rowsSeen);
				state.rowsSeen += 1;
			}
			state.chunksSeen += 1;
			updateProgress(state, activeInternals, expectedRows);
			resources.onProgress?.(state.progress, { ...state });
			return { ...state };
		} catch (error) {
			dispose();
			throw error;
		}
	};
	return {
		state,
		push,
		finish() {
			if (state.isFinished) throw new Error("Accumulation stream has already finished.");
			let activeInternals = resources.internals;
			if (!activeInternals) {
				dispose();
				throw new Error("Accumulation stream has already finished.");
			}
			state.isFinished = true;
			try {
				if (state.rowsSeen === 0) throw new Error("rows is empty; provide at least one coded data row.");
				const result = finishInternals(activeInternals);
				updateProgress(state, activeInternals, expectedRows);
				state.progress = 1;
				const terminalProgress = resources.onProgress;
				activeInternals = void 0;
				dispose();
				terminalProgress?.(1, { ...state });
				return result;
			} finally {
				activeInternals = void 0;
				dispose();
			}
		},
		dispose,
		reset() {
			dispose();
			throw new Error("Reset is not supported for incremental accumulation streams. Create a new stream instead.");
		}
	};
}
function createAccumulationStream(options) {
	const { rows: initialRows, chunkSize = 1e4, expectedRows, onProgress } = options;
	if (chunkSize <= 0 || !Number.isFinite(chunkSize)) throw new Error("chunkSize must be a positive finite number.");
	validateAccumulateOptions(options, { requireRows: false });
	const internals = makeInternals(options);
	const stream = makeAccumulationStreamController({
		internals,
		requiredColumns: [
			...internals.units,
			...internals.conversation,
			...internals.codes,
			...internals.metadata
		],
		onProgress
	}, expectedRows);
	if (initialRows && initialRows.length > 0) for (let index = 0; index < initialRows.length; index += chunkSize) stream.push(initialRows.slice(index, index + chunkSize));
	return stream;
}
var ORDERED_RESERVED_OUTPUT_COLUMNS, ORDERED_VERIFIED_CODE_COUNT, ORDERED_MAX_CODE_COUNT, ORDERED_MAX_EDGE_COUNT, ORDERED_MAX_SVD_WORK_UNITS, ORDERED_MAX_SVD_MATRIX_BYTES, FLOAT64_BYTES, MODELS, WINDOWS, NETWORK_TYPES, ROTATION_METHODS, NODE_POSITION_METHODS;
var init_chunk_MKNCZ6G3 = __esmMin((() => {
	init_chunk_B5R3F624();
	init_chunk_FSSJXZD4();
	ORDERED_RESERVED_OUTPUT_COLUMNS = /* @__PURE__ */ new Set(["ENA_UNIT", "TRAJ_UNIT"]);
	ORDERED_VERIFIED_CODE_COUNT = 7;
	ORDERED_MAX_CODE_COUNT = 12;
	ORDERED_MAX_EDGE_COUNT = ORDERED_MAX_CODE_COUNT * ORDERED_MAX_CODE_COUNT;
	ORDERED_MAX_SVD_WORK_UNITS = 8e6;
	ORDERED_MAX_SVD_MATRIX_BYTES = 1048576;
	FLOAT64_BYTES = 8;
	MODELS = /* @__PURE__ */ new Set([
		"EndPoint",
		"AccumulatedTrajectory",
		"SeparateTrajectory"
	]);
	WINDOWS = /* @__PURE__ */ new Set(["MovingStanzaWindow", "Conversation"]);
	NETWORK_TYPES = /* @__PURE__ */ new Set(["standard", "ordered"]);
	ROTATION_METHODS = /* @__PURE__ */ new Set([
		"svd",
		"mean",
		"generalized",
		"regression",
		"regression2",
		"hena",
		"spherical"
	]);
	NODE_POSITION_METHODS = /* @__PURE__ */ new Set([
		"undirected",
		"directed",
		"directed-ground-response"
	]);
}));
//#endregion
//#region node_modules/jena-js/dist/chunk-4NYP2CS4.js
function prepareDesign(x, standardize) {
	const rows = x.length;
	const cols = x[0]?.length ?? 0;
	const means = Array.from({ length: cols }, (_unused, col) => {
		let total = 0;
		for (const row of x) total += row[col] ?? 0;
		return total / Math.max(1, rows);
	});
	const scales = Array.from({ length: cols }, () => 1);
	const active = Array.from({ length: cols }, () => true);
	const centered = x.map((row) => row.map((value, col) => value - (means[col] ?? 0)));
	for (let col = 0; col < cols; col += 1) {
		let sumSquares = 0;
		for (const row of centered) sumSquares += (row[col] ?? 0) ** 2;
		const sd = Math.sqrt(sumSquares / Math.max(1, rows));
		if (sd === 0) {
			active[col] = false;
			continue;
		}
		if (standardize) {
			scales[col] = sd;
			for (const row of centered) row[col] = (row[col] ?? 0) / sd;
		}
	}
	return {
		rows,
		cols,
		centered,
		means,
		scales,
		active,
		columnNorms: Array.from({ length: cols }, (_unused, col) => {
			let sumSquares = 0;
			for (const row of centered) sumSquares += (row[col] ?? 0) ** 2;
			return sumSquares / Math.max(1, rows);
		})
	};
}
function centerResponses(y) {
	const rows = y.length;
	const cols = y[0]?.length ?? 0;
	const means = Array.from({ length: cols }, (_unused, col) => {
		let total = 0;
		for (const row of y) total += row[col] ?? 0;
		return total / Math.max(1, rows);
	});
	return {
		centered: y.map((row) => row.map((value, col) => value - (means[col] ?? 0))),
		means
	};
}
function rescalePenaltyFactors(penaltyFactor, cols) {
	const raw = penaltyFactor ?? Array.from({ length: cols }, () => 1);
	if (raw.length !== cols) throw new Error(`penaltyFactor must have one entry per predictor (${cols}); got ${raw.length}.`);
	const total = raw.reduce((sum, value) => sum + value, 0);
	if (total <= 0) return raw.map(() => 0);
	return raw.map((value) => value * cols / total);
}
function solveStandardized(design, centeredY, responses, lambda, alpha, penalty, maxIterations, tolerance) {
	const { rows, cols, centered, columnNorms, active } = design;
	const beta = Array.from({ length: cols }, () => Array.from({ length: responses }, () => 0));
	const residual = centeredY.map((row) => [...row]);
	for (let iteration = 0; iteration < maxIterations; iteration += 1) {
		let maxDelta = 0;
		for (let col = 0; col < cols; col += 1) {
			if (!active[col]) continue;
			const norm = columnNorms[col] ?? 0;
			const current = beta[col] ?? [];
			const u = Array.from({ length: responses }, (_unused, k) => {
				let total = 0;
				for (let row = 0; row < rows; row += 1) total += (centered[row]?.[col] ?? 0) * (residual[row]?.[k] ?? 0);
				return total / Math.max(1, rows) + norm * (current[k] ?? 0);
			});
			const uNorm = Math.sqrt(u.reduce((sum, value) => sum + value * value, 0));
			const groupPenalty = lambda * alpha * (penalty[col] ?? 1);
			const shrink = uNorm > groupPenalty ? 1 - groupPenalty / uNorm : 0;
			const denominator = norm + lambda * (1 - alpha) * (penalty[col] ?? 1);
			for (let k = 0; k < responses; k += 1) {
				const next = denominator > 0 ? (u[k] ?? 0) * shrink / denominator : 0;
				const delta = next - (current[k] ?? 0);
				if (delta !== 0) {
					for (let row = 0; row < rows; row += 1) {
						const residualRow = residual[row];
						if (residualRow) residualRow[k] = (residualRow[k] ?? 0) - (centered[row]?.[col] ?? 0) * delta;
					}
					current[k] = next;
					maxDelta = Math.max(maxDelta, Math.abs(delta));
				}
			}
		}
		if (maxDelta < tolerance) break;
	}
	return beta;
}
function multiGaussianElasticNet(x, y, options) {
	const alpha = options.alpha ?? 1;
	const standardize = options.standardize ?? true;
	const maxIterations = options.maxIterations ?? 1e4;
	const tolerance = options.tolerance ?? 1e-12;
	const design = prepareDesign(x, standardize);
	const { centered: centeredY, means: yMeans } = centerResponses(y);
	const responses = y[0]?.length ?? 0;
	const penalty = rescalePenaltyFactors(options.penaltyFactor, design.cols);
	const coefficients = solveStandardized(design, centeredY, responses, options.lambda, alpha, penalty, maxIterations, tolerance).map((row, col) => row.map((value) => value / (design.scales[col] ?? 1)));
	return {
		intercepts: Array.from({ length: responses }, (_unused, k) => {
			let offset = 0;
			for (let col = 0; col < design.cols; col += 1) offset += (coefficients[col]?.[k] ?? 0) * (design.means[col] ?? 0);
			return (yMeans[k] ?? 0) - offset;
		}),
		coefficients,
		lambda: options.lambda
	};
}
function lambdaPath(design, centeredY, alpha, penalty, nlambda, minRatio) {
	const responses = centeredY[0]?.length ?? 0;
	const effectiveAlpha = Math.max(alpha, .001);
	let lambdaMax = 0;
	for (let col = 0; col < design.cols; col += 1) {
		if (!design.active[col] || (penalty[col] ?? 1) <= 0) continue;
		let sumSquares = 0;
		for (let k = 0; k < responses; k += 1) {
			let inner = 0;
			for (let row = 0; row < design.rows; row += 1) inner += (design.centered[row]?.[col] ?? 0) * (centeredY[row]?.[k] ?? 0);
			sumSquares += (inner / Math.max(1, design.rows)) ** 2;
		}
		lambdaMax = Math.max(lambdaMax, Math.sqrt(sumSquares) / (effectiveAlpha * (penalty[col] ?? 1)));
	}
	if (lambdaMax <= 0) lambdaMax = 1;
	const path = [];
	for (let index = 0; index < nlambda; index += 1) path.push(lambdaMax * Math.pow(minRatio, index / (nlambda - 1)));
	return path;
}
function multiGaussianElasticNetCV(x, y, options = {}) {
	const rows = x.length;
	const cols = x[0]?.length ?? 0;
	const alpha = options.alpha ?? 1;
	const standardize = options.standardize ?? true;
	const nfolds = Math.max(2, Math.min(options.nfolds ?? 10, rows));
	const nlambda = options.nlambda ?? 60;
	const minRatio = options.lambdaMinRatio ?? (rows < cols ? .01 : 1e-4);
	const pathDesign = prepareDesign(x, standardize);
	const { centered: centeredY } = centerResponses(y);
	const lambdas = lambdaPath(pathDesign, centeredY, alpha, rescalePenaltyFactors(options.penaltyFactor, cols), nlambda, minRatio);
	const netOptions = (lambda) => {
		const base = {
			lambda,
			alpha,
			standardize
		};
		if (options.penaltyFactor !== void 0) base.penaltyFactor = options.penaltyFactor;
		if (options.maxIterations !== void 0) base.maxIterations = options.maxIterations;
		if (options.tolerance !== void 0) base.tolerance = options.tolerance;
		return base;
	};
	const foldOf = (row) => row % nfolds;
	let bestLambda = lambdas[0] ?? 1;
	let bestError = Number.POSITIVE_INFINITY;
	for (const lambda of lambdas) {
		let squaredError = 0;
		let count = 0;
		for (let fold = 0; fold < nfolds; fold += 1) {
			const trainX = [];
			const trainY = [];
			const testX = [];
			const testY = [];
			for (let row = 0; row < rows; row += 1) {
				(foldOf(row) === fold ? testX : trainX).push(x[row] ?? []);
				(foldOf(row) === fold ? testY : trainY).push(y[row] ?? []);
			}
			if (trainX.length === 0 || testX.length === 0) continue;
			const fit = multiGaussianElasticNet(trainX, trainY, netOptions(lambda));
			for (let row = 0; row < testX.length; row += 1) for (let k = 0; k < (testY[row]?.length ?? 0); k += 1) {
				let predicted = fit.intercepts[k] ?? 0;
				for (let col = 0; col < cols; col += 1) predicted += (fit.coefficients[col]?.[k] ?? 0) * (testX[row]?.[col] ?? 0);
				squaredError += ((testY[row]?.[k] ?? 0) - predicted) ** 2;
				count += 1;
			}
		}
		const meanError = squaredError / Math.max(1, count);
		if (meanError < bestError) {
			bestError = meanError;
			bestLambda = lambda;
		}
	}
	return {
		...multiGaussianElasticNet(x, y, netOptions(bestLambda)),
		lambdas
	};
}
var init_chunk_4NYP2CS4 = __esmMin((() => {}));
//#endregion
//#region node_modules/jena-js/dist/chunk-GJY2X2UA.js
function svdRotation(pointsForProjection) {
	const eigen = symmetricJacobiEigen(covarianceLike(pointsForProjection));
	const divisor = Math.max(1, pointsForProjection.length - 1);
	const eigenvalues = eigen.eigenvalues.map((value) => value / divisor);
	return {
		rotationMatrix: eigen.eigenvectors,
		rotationColumns: eigen.eigenvalues.map((_value, index) => `SVD${index + 1}`),
		eigenvalues
	};
}
function nodeWeightsFromLineWeights(lineWeights, numNodes) {
	return lineWeights.map((adjacency) => {
		const weights = Array.from({ length: numNodes }, () => 0);
		let z = 0;
		for (let x = 0; x < numNodes - 1; x += 1) for (let y = 0; y <= x; y += 1) {
			const value = adjacency[z] ?? 0;
			weights[x + 1] = (weights[x + 1] ?? 0) + .5 * value;
			weights[y] = (weights[y] ?? 0) + .5 * value;
			z += 1;
		}
		const length = Math.max(1e-4, weights.reduce((sum, value) => sum + Math.abs(value), 0));
		return weights.map((value) => value / length);
	});
}
function directedWeightsFromLineWeights(lineWeights, numNodes) {
	return lineWeights.map((adjacency) => {
		const weights = Array.from({ length: numNodes }, () => 0);
		let z = 0;
		for (let x = 0; x < numNodes; x += 1) for (let y = 0; y < numNodes; y += 1) {
			const value = adjacency[z] ?? 0;
			weights[x] = (weights[x] ?? 0) + value;
			if (x !== y) weights[y] = (weights[y] ?? 0) + value;
			z += 1;
		}
		const length = Math.max(1e-4, weights.reduce((sum, value) => sum + Math.abs(value), 0));
		return weights.map((value) => value / length);
	});
}
function solveNodePositionsFromWeights(weights, points) {
	const wt = transpose(weights);
	const normal = multiplyMatrices(wt, weights);
	const dims = points[0]?.length ?? 0;
	const nodeCount = weights[0]?.length ?? 0;
	const nodeColumns = [];
	for (let dim = 0; dim < dims; dim += 1) {
		const rhs = multiplyMatrices(wt, points.map((row) => [row[dim] ?? 0])).map((row) => row[0] ?? 0);
		nodeColumns.push(solveLinearSystem(normal, rhs));
	}
	const nodes = Array.from({ length: nodeCount }, (_unused, nodeIndex) => nodeColumns.map((col) => col[nodeIndex] ?? 0));
	return {
		nodes,
		centroids: multiplyMatrices(weights, nodes),
		weights
	};
}
function lwsLeastSquaresPositions(lineWeights, points, numNodes) {
	if (lineWeights.length !== points.length) throw new Error("lineWeights and points must have the same number of rows.");
	if (points.length === 0) return {
		nodes: [],
		centroids: [],
		weights: []
	};
	return solveNodePositionsFromWeights(nodeWeightsFromLineWeights(lineWeights, numNodes), points);
}
function directedNodeCount(adjacencyLength, method) {
	const numNodes = Math.round(Math.sqrt(adjacencyLength));
	if (numNodes * numNodes !== adjacencyLength) throw new Error(`${method} requires a directed adjacency with n*n columns per row, got ${adjacencyLength}. Undirected models produce n*(n-1)/2 upper-triangle columns; use nodePositionMethod: "undirected" for them.`);
	return numNodes;
}
function validateDirectedAdjacencyShape(lineWeights, method) {
	const firstRow = lineWeights[0];
	if (!Array.isArray(firstRow)) throw new Error(`${method} lineWeights row 0 must be an array.`);
	const adjacencyLength = firstRow.length;
	const numNodes = directedNodeCount(adjacencyLength, method);
	for (let rowIndex = 0; rowIndex < lineWeights.length; rowIndex += 1) {
		const row = lineWeights[rowIndex];
		if (!Array.isArray(row) || row.length !== adjacencyLength) throw new Error(`${method} lineWeights row ${rowIndex} must contain ${adjacencyLength} directed adjacency cells matching row 0; got ${Array.isArray(row) ? row.length : typeof row}.`);
		for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
			const value = row[columnIndex];
			if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${method} lineWeights[${rowIndex}][${columnIndex}] must be a finite number; got ${String(value)}.`);
		}
	}
	return numNodes;
}
function validateDirectedPoints(points, method) {
	const firstRow = points[0];
	if (!Array.isArray(firstRow)) throw new Error(`${method} points row 0 must be an array.`);
	const dimensions = firstRow.length;
	for (let rowIndex = 0; rowIndex < points.length; rowIndex += 1) {
		const row = points[rowIndex];
		if (!Array.isArray(row) || row.length !== dimensions) throw new Error(`${method} points row ${rowIndex} must contain ${dimensions} dimensions matching row 0; got ${Array.isArray(row) ? row.length : typeof row}.`);
		for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
			const value = row[columnIndex];
			if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${method} points[${rowIndex}][${columnIndex}] must be a finite number; got ${String(value)}.`);
		}
	}
}
function directedNodePositions(lineWeights, points) {
	if (lineWeights.length !== points.length) throw new Error("lineWeights and points must have the same number of rows.");
	if (points.length === 0) return {
		nodes: [],
		centroids: [],
		weights: []
	};
	const numNodes = validateDirectedAdjacencyShape(lineWeights, "directedNodePositions");
	validateDirectedPoints(points, "directedNodePositions");
	return solveNodePositionsFromWeights(directedWeightsFromLineWeights(lineWeights, numNodes), points);
}
function directedNodePositionsWithGroundResponseAdded(lineWeights, points) {
	if (lineWeights.length !== points.length) throw new Error("lineWeights and points must have the same number of rows.");
	if (lineWeights.length % 2 !== 0) throw new Error(`directedNodePositionsWithGroundResponseAdded requires an even number of paired ground/response rows; got ${lineWeights.length}.`);
	if (points.length === 0) return {
		nodes: [],
		centroids: [],
		weights: []
	};
	const numNodes = validateDirectedAdjacencyShape(lineWeights, "directedNodePositionsWithGroundResponseAdded");
	validateDirectedPoints(points, "directedNodePositionsWithGroundResponseAdded");
	const weights = directedWeightsFromLineWeights(lineWeights, numNodes);
	const addedWeights = [];
	const addedPoints = [];
	for (let row = 0; row + 1 < weights.length; row += 2) {
		addedWeights.push(Array.from({ length: numNodes }, (_unused, col) => (weights[row]?.[col] ?? 0) + (weights[row + 1]?.[col] ?? 0)));
		const dims = points[0]?.length ?? 0;
		addedPoints.push(Array.from({ length: dims }, (_unused, col) => (points[row]?.[col] ?? 0) + (points[row + 1]?.[col] ?? 0)));
	}
	const solved = solveNodePositionsFromWeights(addedWeights, addedPoints);
	return {
		nodes: solved.nodes,
		centroids: multiplyMatrices(weights, solved.nodes),
		weights
	};
}
function nodesAsRows(codes, nodeMatrix, dimensions) {
	return nodeMatrix.map((row, index) => ({
		code: codes[index] ?? String(index),
		...Object.fromEntries(dimensions.map((dimension, dimIndex) => [dimension, row[dimIndex] ?? 0]))
	}));
}
function centroidsAsRows(unitLabels, centroidMatrix, dimensions) {
	return centroidMatrix.map((row, index) => ({
		unit: unitLabels[index] ?? String(index),
		...Object.fromEntries(dimensions.map((dimension, dimIndex) => [dimension, row[dimIndex] ?? 0]))
	}));
}
function isBooleanSelector(selector) {
	return selector.every((value) => typeof value === "boolean");
}
function groupMask(selector, rows) {
	if (isBooleanSelector(selector)) {
		if (selector.length !== rows.length) throw new Error("Group selector length must match row count.");
		return selector;
	}
	const values = new Set(selector.map(String));
	return rows.map((row) => values.has(String(row.ENA_UNIT ?? row.unit ?? "")));
}
function isSelector(value) {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string" || typeof entry === "boolean");
}
function normalizeMeanGroups(groups) {
	if (Array.isArray(groups) && groups.length === 2 && isSelector(groups[0]) && isSelector(groups[1])) return [[groups[0], groups[1]]];
	return groups;
}
function rowsByMask(matrix, mask) {
	return matrix.filter((_row, index) => mask[index] ?? false);
}
function columnsToMatrix(columns, rows) {
	return Array.from({ length: rows }, (_unused, row) => columns.map((col) => col[row] ?? 0));
}
function combineRotationColumns(columns) {
	return columnsToMatrix(columns, columns[0]?.length ?? 0);
}
function orthogonalSvd(data, leadingColumns) {
	const width = data[0]?.length ?? 0;
	if (width === 0) return [];
	const q = gramSchmidtComplete(leadingColumns, width);
	const leadingCount = leadingColumns.length;
	const qLeading = q.map((row) => row.slice(0, leadingCount));
	const qRest = q.map((row) => row.slice(leadingCount));
	if ((qRest[0]?.length ?? 0) === 0) return qLeading;
	const restRotation = svdRotation(multiplyMatrices(data, qRest)).rotationMatrix;
	const rest = multiplyMatrices(qRest, restRotation);
	return q.map((_row, index) => [...qLeading[index] ?? [], ...rest[index] ?? []]);
}
function makeColumnNames(prefix, count, start = 1) {
	return Array.from({ length: count }, (_unused, index) => `${prefix}${index + start}`);
}
function makeUniqueNames(names) {
	const seen = /* @__PURE__ */ new Map();
	return names.map((name) => {
		const count = seen.get(name) ?? 0;
		seen.set(name, count + 1);
		return count === 0 ? name : `${name}.${count}`;
	});
}
function assembleRotation(points, leading, leadingNames) {
	const width = points[0]?.length ?? 0;
	let deflated = points;
	for (const vector of leading) deflated = subtractOuterProjection(deflated, vector);
	const svd = svdRotation(deflated);
	const leadingEigenvalue = svd.eigenvalues[0] ?? 0;
	const rankThreshold = Math.max(Number.MIN_VALUE, leadingEigenvalue * 1e-12);
	const significant = Math.min(svd.eigenvalues.filter((value) => value > rankThreshold).length, Math.max(0, width - leading.length));
	const columns = [...leading];
	for (let index = 0; index < significant; index += 1) columns.push(svd.rotationMatrix.map((row) => row[index] ?? 0));
	const completed = gramSchmidtComplete(columns, width);
	for (let index = columns.length; index < width; index += 1) columns.push(completed.map((row) => row[index] ?? 0));
	const residualCount = Math.max(0, width - leading.length);
	return {
		rotationMatrix: combineRotationColumns(columns),
		rotationColumns: makeUniqueNames([...leadingNames, ...makeColumnNames("SVD", residualCount, leading.length + 1)]),
		eigenvalues: []
	};
}
function rotateWithLeadingColumns(data, leadingColumns, leadingNames) {
	const rotationMatrix = orthogonalSvd(data, leadingColumns);
	const residualCount = Math.max(0, (rotationMatrix[0]?.length ?? 0) - leadingNames.length);
	return {
		rotationMatrix,
		rotationColumns: [...leadingNames, ...makeColumnNames("SVD", residualCount, leadingNames.length + 1)],
		eigenvalues: []
	};
}
function rotateByMean(pointsForProjection, enadata, params) {
	const groups = normalizeMeanGroups(params.groups);
	if (groups.length === 0) throw new Error("Unable to rotate without at least one pair of groups.");
	const rows = enadata.connectionCounts;
	let deflated = centerData(pointsForProjection);
	const weights = [];
	for (const [leftSelector, rightSelector] of groups) {
		const left = rowsByMask(deflated, groupMask(leftSelector, rows));
		const right = rowsByMask(deflated, groupMask(rightSelector, rows));
		if (left.length === 0 || right.length === 0) throw new Error("Mean rotation groups must both contain at least one row.");
		const direction = normalizeVector(subtractVectors$1(meanColumns(left), meanColumns(right)));
		if (l2Norm(direction) === 0) throw new Error("Mean rotation groups have identical means.");
		deflated = subtractOuterProjection(deflated, direction);
		weights.push(direction);
	}
	return rotateWithLeadingColumns(deflated, weights, makeColumnNames("MR", weights.length));
}
function scalarToNumber(value) {
	if (typeof value === "number") return value;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (value === null) return 0;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : NaN;
}
function metadataVector(rows, columnName) {
	return rows.map((row) => row[columnName] ?? null);
}
function encodeVector(values) {
	const numeric = values.map(scalarToNumber);
	if (numeric.every(Number.isFinite)) return numeric;
	const levels = [...new Set(values.map((value) => String(value)))].sort();
	return values.map((value) => levels.indexOf(String(value)) + 1);
}
function isNumericVector(values) {
	return values.map(scalarToNumber).every(Number.isFinite);
}
function resolveVarNames(value) {
	return Array.isArray(value) ? value : [value];
}
function simpleLinearFit(response, predictor) {
	const design = predictor.map((value) => [1, value]);
	const coefficients = designSolve(design, response);
	return {
		coefficients,
		fitted: multiplyMatrices(design, coefficients)
	};
}
function categoricalMainEffect(response, target) {
	const levels = [...new Set(target.map((value) => String(value)))];
	const means = /* @__PURE__ */ new Map();
	for (const level of levels) {
		const rows = response.filter((_row, index) => String(target[index] ?? "") === level);
		means.set(level, meanColumns(rows));
	}
	return response.map((_row, index) => means.get(String(target[index] ?? "")) ?? []);
}
function computeBetweenGroupScatter(matrix, groups) {
	const width = matrix[0]?.length ?? 0;
	const totalMean = meanColumns(matrix);
	const out = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
	const levels = [...new Set(groups.map((value) => String(value)))];
	for (const level of levels) {
		const rows = matrix.filter((_row, index) => String(groups[index] ?? "") === level);
		if (rows.length === 0) continue;
		const diff = subtractVectors$1(meanColumns(rows), totalMean);
		for (let i = 0; i < width; i += 1) for (let j = 0; j < width; j += 1) {
			const outRow = out[i];
			if (outRow) outRow[j] = (outRow[j] ?? 0) + rows.length * (diff[i] ?? 0) * (diff[j] ?? 0);
		}
	}
	return out;
}
function gmr(points, rows, vars) {
	const target = metadataVector(rows, vars[0] ?? "");
	const targetEncoded = encodeVector(target);
	const numericTarget = isNumericVector(target);
	const simple = simpleLinearFit(points, targetEncoded);
	const fittedUnadjusted = numericTarget ? simple.fitted : categoricalMainEffect(points, target);
	let fittedMainEffect = fittedUnadjusted;
	if (vars.length > 1) {
		const design = buildMetadataDesign(rows, vars);
		const predictors = design.matrix.map((row) => row.slice(1));
		const predictorLabels = design.labels.slice(1);
		const fit = multiGaussianElasticNetCV(predictors, points, {
			alpha: 1,
			penaltyFactor: predictorLabels.map((label) => label === (vars[0] ?? "") ? 0 : 1)
		});
		const x1Index = predictorLabels.indexOf(vars[0] ?? "");
		const x1Coefficients = fit.coefficients[x1Index] ?? [];
		fittedMainEffect = predictors.map((row) => x1Coefficients.map((coefficient) => (row[x1Index] ?? 0) * coefficient));
	}
	if (numericTarget) return {
		direction: normalizeVector(simple.coefficients[1] ?? []),
		fittedMainEffect,
		fittedUnadjusted,
		target
	};
	return {
		direction: normalizeVector(symmetricJacobiEigen(computeBetweenGroupScatter(fittedMainEffect, target)).eigenvectors.map((row) => row[0] ?? 0)),
		fittedMainEffect,
		fittedUnadjusted,
		target
	};
}
function rotateByGeneralized(pointsForProjection, enadata, params) {
	const x = gmr(pointsForProjection, enadata.metaData, resolveVarNames(params.xVar));
	const a = pointsForProjection;
	let deflated = subtractOuterProjection(a, x.direction);
	let x1;
	if (params.select2Groups) {
		const [left, right] = params.select2Groups;
		const leftRows = deflated.filter((_row, index) => String(x.target[index] ?? "") === String(left));
		const rightRows = deflated.filter((_row, index) => String(x.target[index] ?? "") === String(right));
		if (leftRows.length > 0 && rightRows.length > 0) {
			const diff = subtractVectors$1(meanColumns(leftRows), meanColumns(rightRows));
			if (l2Norm(diff) > 1e-10) x1 = normalizeVector(diff);
		}
	}
	if (!x1) x1 = svdRotation(x.fittedUnadjusted).rotationMatrix.map((row) => row[0] ?? 0);
	const projection = dot(x1, x.direction);
	if (Math.abs(projection) < .99) {
		x1 = normalizeVector(subtractVectors$1(x1, x.direction.map((value) => value * projection)));
		deflated = subtractOuterProjection(deflated, x1);
	}
	const yDirection = params.yVar ? gmr(deflated, enadata.metaData, resolveVarNames(params.yVar)).direction : svdRotation(deflated).rotationMatrix.map((row) => row[0] ?? 0);
	const yName = params.yVar ? "RR2" : "SVD2";
	return assembleRotation(a, [x.direction, normalizeVector(yDirection)], ["RR1", yName]);
}
function stripLmWrapper(formula) {
	const match = formula.match(/formula\s*=\s*([^,)]+)/);
	if (match?.[1]) return match[1].trim();
	return formula.replace(/^lm\s*\(/, "").replace(/\)$/, "").trim();
}
function parseFormula(formula) {
	const [lhsRaw, rhsRaw] = stripLmWrapper(formula).split("~");
	const lhs = lhsRaw?.trim();
	const rhs = rhsRaw?.trim();
	if (!lhs || !rhs) throw new Error(`Invalid regression formula: ${formula}`);
	return {
		lhs,
		rhsTerms: rhs.split("+").map((term) => term.trim()).filter(Boolean)
	};
}
function buildMetadataDesign(rows, terms) {
	const columns = [Array.from({ length: rows.length }, () => 1)];
	const labels = ["(Intercept)"];
	for (const term of terms) {
		const pieces = term.split(":").map((piece) => piece.trim());
		let values = Array.from({ length: rows.length }, () => 1);
		for (const piece of pieces) {
			const encoded = encodeVector(metadataVector(rows, piece));
			values = values.map((value, index) => value * (encoded[index] ?? 0));
		}
		columns.push(values);
		labels.push(term);
	}
	return {
		matrix: columnsToMatrix(columns, rows.length),
		labels
	};
}
function buildFormulaDesign(rows, points, terms) {
	const columns = [Array.from({ length: rows.length }, () => 1)];
	const labels = ["(Intercept)"];
	for (const term of terms) {
		const pieces = term.split(":").map((piece) => piece.trim());
		const hasV = pieces.includes("V");
		const nonV = pieces.filter((piece) => piece !== "V");
		const metaMultiplier = nonV.reduce((current, piece) => {
			const encoded = encodeVector(metadataVector(rows, piece));
			return current.map((value, index) => value * (encoded[index] ?? 0));
		}, Array.from({ length: rows.length }, () => 1));
		if (hasV) {
			const width = points[0]?.length ?? 0;
			for (let dim = 0; dim < width; dim += 1) {
				columns.push(points.map((row, index) => (row[dim] ?? 0) * (metaMultiplier[index] ?? 1)));
				labels.push(nonV.length > 0 ? `V${dim + 1}:${nonV.join(":")}` : `V${dim + 1}`);
			}
		} else {
			columns.push(metaMultiplier);
			labels.push(term);
		}
	}
	return {
		matrix: columnsToMatrix(columns, rows.length),
		labels
	};
}
function firstPredictorVectorFromRegression(points, rows, formula, fallbackName) {
	const spec = parseFormula(formula);
	const design = buildMetadataDesign(rows, spec.rhsTerms);
	return {
		vector: normalizeVector(designSolve(design.matrix, points)[1] ?? []),
		name: `${fallbackName || design.labels[1] || spec.lhs}_reg`
	};
}
function vCoefficientVectorFromRegression(points, rows, formula) {
	const spec = parseFormula(formula);
	const design = buildFormulaDesign(rows, points, spec.rhsTerms);
	const response = encodeVector(metadataVector(rows, spec.lhs)).map((value) => [value]);
	const coefficients = designSolve(design.matrix, response);
	return {
		vector: normalizeVector(design.labels.map((label, index) => ({
			label,
			value: coefficients[index]?.[0] ?? 0
		})).filter((entry) => entry.label.startsWith("V") && !entry.label.includes(":")).map((entry) => entry.value)),
		name: "V_reg"
	};
}
function rotateByRegression(pointsForProjection, enadata, params) {
	const fallbackName = enadata.codeColumns[0] ?? "V";
	const x = firstPredictorVectorFromRegression(pointsForProjection, enadata.metaData, params.xVar, fallbackName);
	const columns = [x.vector];
	const names = [x.name];
	if (params.yVar) {
		const y = firstPredictorVectorFromRegression(pointsForProjection, enadata.metaData, params.yVar, fallbackName);
		columns.push(y.vector);
		names.push(y.name);
	}
	return assembleRotation(pointsForProjection, columns, names);
}
function rotateByRegression2(pointsForProjection, enadata, params) {
	const x = vCoefficientVectorFromRegression(pointsForProjection, enadata.metaData, params.xVar);
	const columns = [x.vector];
	const names = [x.name];
	if (params.yVar) {
		const y = vCoefficientVectorFromRegression(pointsForProjection, enadata.metaData, params.yVar);
		columns.push(y.vector);
		names.push(y.name);
	}
	return assembleRotation(pointsForProjection, columns, names);
}
function runLengthEncode(values) {
	let id = -1;
	let previous;
	return values.map((value) => {
		const key = String(value);
		if (key !== previous) {
			id += 1;
			previous = key;
		}
		return id;
	});
}
function centerVectorValues(values) {
	const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
	return values.map((value) => value - mean);
}
function isNumericColumn(values) {
	return values.every((value) => typeof value === "number" && Number.isFinite(value));
}
function factorContrastColumns(values, name) {
	const levels = [...new Set(values.map((value) => String(value)))].sort();
	const columns = [];
	const names = [];
	for (const level of levels.slice(1)) {
		columns.push(values.map((value) => String(value) === level ? 1 : 0));
		names.push(`${name}${level}`);
	}
	return {
		columns,
		names
	};
}
function rotateByHena(pointsForProjection, enadata, params) {
	const data = centerData(pointsForProjection);
	const rows = enadata.metaData;
	const centering = params.centering ?? true;
	const encodeVariable = (name) => {
		const raw = metadataVector(rows, name);
		if (isNumericColumn(raw)) return {
			values: raw.map((value) => Number(value)),
			label: name
		};
		return {
			values: runLengthEncode(raw),
			label: `${name}_f`
		};
	};
	const x = encodeVariable(params.xVar);
	const y = params.yVar ? encodeVariable(params.yVar) : void 0;
	if (centering) {
		x.values = centerVectorValues(x.values);
		if (y) y.values = centerVectorValues(y.values);
	}
	const columns = [Array.from({ length: rows.length }, () => 1), x.values];
	if (y) columns.push(y.values);
	for (const control of params.controlVars ?? []) {
		const raw = metadataVector(rows, control);
		if (isNumericColumn(raw)) columns.push(raw.map((value) => Number(value)));
		else columns.push(...factorContrastColumns(raw, control).columns);
	}
	if (params.includeXY && y) columns.push(x.values.map((value, index) => value * (y.values[index] ?? 0)));
	const coefficients = designSolve(columnsToMatrix(columns, rows.length), data);
	const v1 = normalizeVector(coefficients[1] ?? []);
	if (l2Norm(v1) === 0) throw new Error("HENA rotation could not derive a non-zero rotation vector.");
	const leadingColumns = [v1];
	const leadingNames = [`x_${x.label}`];
	if (y) {
		const rawY = coefficients[2] ?? [];
		const orthogonalized = normalizeVector(subtractVectors$1(rawY, v1.map((value) => value * dot(rawY, v1))));
		if (l2Norm(orthogonalized) > 0) {
			leadingColumns.push(orthogonalized);
			leadingNames.push(`y_${y.label}`);
		}
	}
	const result = assembleRotation(data, leadingColumns, leadingNames);
	const svd = svdRotation(deflateMatrix(data, leadingColumns));
	return {
		...result,
		eigenvalues: svd.eigenvalues
	};
}
function anchorVector(anchor, enadata, width) {
	if (Array.isArray(anchor)) {
		if (anchor.length !== width) throw new Error("Spherical rotation anchor length must match adjacency width.");
		return normalizeVector(anchor);
	}
	if (typeof anchor === "string") {
		const index = enadata.codeColumns.indexOf(anchor);
		if (index < 0) throw new Error(`Unknown spherical rotation anchor: ${anchor}`);
		return Array.from({ length: width }, (_unused, col) => col === index ? 1 : 0);
	}
	return Array.from({ length: width }, (_unused, col) => col === 0 ? 1 : 0);
}
function rotateBySpherical(pointsForProjection, enadata, params = {}) {
	const width = pointsForProjection[0]?.length ?? 0;
	const first = anchorVector(params.anchor, enadata, width);
	let second = anchorVector(params.secondaryAnchor, enadata, width);
	second = normalizeVector(subtractVectors$1(second, first.map((value) => value * dot(second, first))));
	const leading = l2Norm(second) > 0 ? [first, second] : [first];
	return rotateWithLeadingColumns(deflateMatrix(pointsForProjection, leading), leading, leading.map((_column, index) => `SPH${index + 1}`));
}
function deflateMatrix(matrix, vectors) {
	return vectors.reduce((current, vector) => subtractOuterProjection(current, vector), matrix);
}
var init_chunk_GJY2X2UA = __esmMin((() => {
	init_chunk_4NYP2CS4();
	init_chunk_FSSJXZD4();
}));
//#endregion
//#region node_modules/jena-js/dist/chunk-QY374ADW.js
function accumulateData(options) {
	validateAccumulateOptions(options);
	return accumulateDataChunked({
		...options,
		chunkSize: Math.max(1, options.rows.length)
	});
}
function nonCodePart(row, codeColumns) {
	const codeSet = new Set(codeColumns);
	return Object.fromEntries(Object.entries(row).filter(([key]) => !codeSet.has(key)));
}
function rowsFromMatrix(baseRows, codeColumns, columns, matrix) {
	return baseRows.map((row, rowIndex) => ({
		...nonCodePart(row, codeColumns),
		...Object.fromEntries(columns.map((column, columnIndex) => [column, matrix[rowIndex]?.[columnIndex] ?? 0]))
	}));
}
function selectMatrixColumns(matrix, count) {
	return matrix.map((row) => row.slice(0, count));
}
function rowHasSignal(row) {
	return row.reduce((sum, value) => sum + value, 0) !== 0;
}
function centerForProjection(lineWeights, centerAlignToOrigin, rotationSet) {
	if (rotationSet) {
		const centerVector2 = rotationSet.centerVector;
		return {
			centerVector: centerVector2,
			pointsForProjection: lineWeights.map((row) => centerAlignToOrigin && !rowHasSignal(row) ? row.map(() => 0) : row.map((value, index) => value - (centerVector2[index] ?? 0)))
		};
	}
	if (!centerAlignToOrigin) {
		const centerVector2 = meanColumns(lineWeights);
		return {
			pointsForProjection: centerData(lineWeights, centerVector2),
			centerVector: centerVector2
		};
	}
	const nonZeroRows = lineWeights.filter(rowHasSignal);
	if (nonZeroRows.length === 0) throw new Error("There were no co-occurrences of codes for any of the units within the model as defined.");
	const centerVector = meanColumns(nonZeroRows);
	return {
		centerVector,
		pointsForProjection: lineWeights.map((row) => rowHasSignal(row) ? row.map((value, index) => value - (centerVector[index] ?? 0)) : row.map(() => 0))
	};
}
function adjacencyKeysEqual(left, right) {
	if (left.length !== right.length) return false;
	return left.every((entry, index) => {
		const other = right[index];
		return other?.source === entry.source && other.target === entry.target && other.sourceIndex === entry.sourceIndex && other.targetIndex === entry.targetIndex;
	});
}
function makeRotation(enadata, pointsForProjection, options) {
	if (options.rotationSet) {
		if (!adjacencyKeysEqual(enadata.adjacencyKey, options.rotationSet.adjacencyKey)) throw new Error("Rotation sets must have identical adjacency keys.");
		return {
			rotationMatrix: options.rotationSet.rotationMatrix,
			rotationColumns: options.rotationSet.rotationColumns,
			eigenvalues: options.rotationSet.eigenvalues
		};
	}
	const rotation = options.rotation;
	if (!rotation || rotation.method === "svd") return svdRotation(pointsForProjection);
	switch (rotation.method) {
		case "mean": return rotateByMean(pointsForProjection, enadata, rotation.params);
		case "generalized": return rotateByGeneralized(pointsForProjection, enadata, rotation.params);
		case "regression": return rotateByRegression(pointsForProjection, enadata, rotation.params);
		case "regression2": return rotateByRegression2(pointsForProjection, enadata, rotation.params);
		case "hena": return rotateByHena(pointsForProjection, enadata, rotation.params);
		case "spherical": return rotateBySpherical(pointsForProjection, enadata, rotation.params ?? {});
	}
}
function validateOrderedMakeSetPhase(enadata, options) {
	if (enadata.networkType !== "ordered") return;
	if (options.rotationSet !== void 0) throw new Error("Ordered makeSet does not accept rotationSet in the descriptive SVD-only phase.");
	const rotationMethod = options.rotation?.method;
	if (rotationMethod !== void 0 && rotationMethod !== "svd") throw new Error(`Ordered makeSet supports only the default or explicit "svd" rotation in the descriptive SVD-only phase; got "${rotationMethod}".`);
	if (options.nodePositionMethod === "undirected") throw new Error("Ordered network analysis requires a directed node position method; got \"undirected\". Omit nodePositionMethod to use \"directed\".");
	if (options.nodePositionMethod === "directed-ground-response") throw new Error("Ordered ENAData supports nodePositionMethod \"directed\"; \"directed-ground-response\" requires explicitly paired ground/response rows.");
	assertOrderedSvdBudget(enadata.connectionMatrix.length, enadata.codeColumns.length);
}
function makeNodePositions(lineWeights, points, codeCount, networkType, options) {
	const method = options.nodePositionMethod ?? (networkType === "ordered" ? "directed" : "undirected");
	if (networkType === "ordered" && method === "undirected") throw new Error("Ordered network analysis requires a directed node position method; got \"undirected\". Omit nodePositionMethod to use \"directed\".");
	if (networkType === "ordered" && method === "directed-ground-response") throw new Error("Ordered ENAData supports nodePositionMethod \"directed\"; \"directed-ground-response\" requires explicitly paired ground/response rows.");
	if (method !== "undirected") {
		const width = lineWeights[0]?.length ?? 0;
		if (width !== codeCount * codeCount) throw new Error(`nodePositionMethod "${method}" requires a directed adjacency (${codeCount * codeCount} columns for ${codeCount} codes), but this model is undirected (${width} upper-triangle columns). Use nodePositionMethod: "undirected".`);
	}
	switch (method) {
		case "undirected": return lwsLeastSquaresPositions(lineWeights, points, codeCount);
		case "directed": return directedNodePositions(lineWeights, points);
		case "directed-ground-response": return directedNodePositionsWithGroundResponseAdded(lineWeights, points);
	}
}
function makeSet(enadata, options = {}) {
	validateENADataNetworkContract(enadata);
	validateMakeSetOptions(options);
	validateOrderedMakeSetPhase(enadata, options);
	const dimensions = options.dimensions ?? 2;
	const centerAlignToOrigin = options.centerAlignToOrigin ?? true;
	const lineWeightsMatrix = sphereNorm(enadata.connectionMatrix);
	const { pointsForProjection, centerVector } = centerForProjection(lineWeightsMatrix, centerAlignToOrigin, options.rotationSet);
	const rotationResult = makeRotation(enadata, pointsForProjection, options);
	const dimCount = Math.min(dimensions, rotationResult.rotationColumns.length);
	const dimensionNames = rotationResult.rotationColumns.slice(0, dimCount);
	const fullPointsMatrix = multiplyMatrices(pointsForProjection, rotationResult.rotationMatrix);
	const pointsMatrix = selectMatrixColumns(fullPointsMatrix, dimCount);
	const nodePositionResult = makeNodePositions(lineWeightsMatrix, pointsMatrix, enadata.codes.length, enadata.networkType ?? "standard", options);
	const variances = varianceColumns(fullPointsMatrix);
	const varianceTotal = variances.reduce((sum, value) => sum + value, 0);
	const variance = Object.fromEntries(rotationResult.rotationColumns.map((name, index) => [name, varianceTotal === 0 ? 0 : (variances[index] ?? 0) / varianceTotal]));
	const rotation = {
		codes: enadata.codes,
		adjacencyKey: enadata.adjacencyKey,
		rotationMatrix: rotationResult.rotationMatrix,
		rotationColumns: rotationResult.rotationColumns,
		eigenvalues: rotationResult.eigenvalues,
		centerVector,
		nodes: options.rotationSet?.nodes ?? nodesAsRows(enadata.codes, nodePositionResult.nodes, dimensionNames)
	};
	return {
		...enadata,
		lineWeights: rowsFromMatrix(enadata.connectionCounts, enadata.codeColumns, enadata.codeColumns, lineWeightsMatrix),
		pointsForProjection: rowsFromMatrix(enadata.connectionCounts, enadata.codeColumns, enadata.codeColumns, pointsForProjection),
		points: rowsFromMatrix(enadata.connectionCounts, enadata.codeColumns, dimensionNames, pointsMatrix),
		rotation,
		variance,
		centroids: centroidsAsRows(enadata.unitLabels, nodePositionResult.centroids, dimensionNames)
	};
}
function extractMakeSetOptions(options) {
	const makeOptions = {};
	if (options.dimensions !== void 0) makeOptions.dimensions = options.dimensions;
	if (options.centerAlignToOrigin !== void 0) makeOptions.centerAlignToOrigin = options.centerAlignToOrigin;
	if (options.rotation !== void 0) makeOptions.rotation = options.rotation;
	if (options.rotationSet !== void 0) makeOptions.rotationSet = options.rotationSet;
	if (options.nodePositionMethod !== void 0) makeOptions.nodePositionMethod = options.nodePositionMethod;
	return makeOptions;
}
function ena(options) {
	return makeSet(accumulateData(options), extractMakeSetOptions(options));
}
var init_chunk_QY374ADW = __esmMin((() => {
	init_chunk_MKNCZ6G3();
	init_chunk_GJY2X2UA();
	init_chunk_FSSJXZD4();
}));
//#endregion
//#region node_modules/jena-js/dist/index.js
var init_dist = __esmMin((() => {
	init_chunk_QY374ADW();
}));
//#endregion
//#region packages/analysis/src/build-identity.ts
function injected(value, fallback) {
	return typeof value === "string" && value.trim() !== "" ? value : fallback;
}
var ANALYSIS_BUILD_IDENTITY;
var init_build_identity = __esmMin((() => {
	ANALYSIS_BUILD_IDENTITY = Object.freeze({
		jenaVersion: injected("0.7.0-ona.0", "development-unbound"),
		jenaCommit: injected("90790856f00bdef63dbd27fc3a5b502e8cffe65f", "development-unbound"),
		jenaTarballIntegrity: injected("sha512-gBhKP9d7C3akXTPlU03AJHBs+dBBDt1TUFGx96P/pB/s0GEGGX2aZFLJGWf9HLc+wuBJIjrJn7tIGicg1WQflQ==", "development-unbound"),
		sdkVersion: injected("0.2.0-implemented-unverified.11", "development-unbound"),
		buildId: injected("9ce41017d3d17dd24beac7c7d08f74d7e92d2a1c", "development-unbound"),
		bound: true
	});
}));
//#endregion
//#region packages/analysis/src/types.ts
var AnalysisValidationError;
var init_types = __esmMin((() => {
	AnalysisValidationError = class extends Error {
		issues;
		constructor(issues) {
			super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
			this.name = "AnalysisValidationError";
			this.issues = issues;
		}
	};
}));
//#endregion
//#region packages/analysis/src/validation.ts
function issue$1(code, path, message) {
	return {
		code,
		path,
		message
	};
}
function validateKnownKeys(value, path, allowed, issues) {
	if (value === void 0) return;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		issues.push(issue$1("INVALID_OBJECT", path, "must be an object"));
		return;
	}
	const allowedSet = new Set(allowed);
	for (const key of Object.keys(value)) if (!allowedSet.has(key)) issues.push(issue$1("UNKNOWN_OPTION", `${path}.${key}`, "is not part of the versioned input contract"));
}
function validateEnvelopeShape(input) {
	const issues = [];
	validateKnownKeys(input, "input", [
		"rows",
		"mapping",
		"config",
		"limits"
	], issues);
	validateKnownKeys(input.mapping, "mapping", [
		"units",
		"conversation",
		"codes",
		"metadata",
		"trajectory"
	], issues);
	validateKnownKeys(input.mapping.trajectory, "mapping.trajectory", [
		"participant",
		"group",
		"time",
		"timeOrder",
		"cohortPolicy"
	], issues);
	validateKnownKeys(input.config, "config", [
		"model",
		"window",
		"weightBy",
		"windowSizeBack",
		"windowSizeForward",
		"centerAlignToOrigin"
	], issues);
	validateKnownKeys(input.limits, "limits", Object.keys(DEFAULT_ANALYSIS_LIMITS), issues);
	if (issues.length > 0) throw new AnalysisValidationError(issues);
}
function isRawScalar(value) {
	return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
function scalarToken$2(value) {
	if (value === null) return ["null", ""];
	if (typeof value === "string") return ["string", value];
	if (typeof value === "boolean") return ["boolean", value ? "true" : "false"];
	if (Object.is(value, -0)) return ["number", "-0"];
	return ["number", String(value)];
}
function canonicalScalars(values) {
	return JSON.stringify(values.map(scalarToken$2));
}
function displayScalar$1(value) {
	if (value === null) return "";
	return String(value);
}
function typedValue$2(value) {
	return {
		canonical: canonicalScalars([value]),
		display: displayScalar$1(value),
		value
	};
}
function entityKey(row, columns) {
	const values = columns.map((column) => row[column] ?? null);
	return {
		canonical: canonicalScalars(values),
		display: values.map(displayScalar$1).join(" · "),
		columns: [...columns],
		values
	};
}
function normalizeCode(value, path) {
	let numeric;
	if (typeof value === "boolean") numeric = value ? 1 : 0;
	else if (typeof value === "number") numeric = value;
	else if (typeof value === "string" && value.trim() !== "") numeric = Number(value);
	else throw new AnalysisValidationError([issue$1("INVALID_CODE_VALUE", path, "code values must be finite non-negative numbers, numeric strings, or booleans")]);
	if (!Number.isFinite(numeric) || numeric < 0) throw new AnalysisValidationError([issue$1("INVALID_CODE_VALUE", path, "code values must be finite and non-negative")]);
	return numeric;
}
function normalizedConfig(input) {
	return {
		model: input.config?.model ?? (input.mapping.trajectory ? "AccumulatedTrajectory" : "EndPoint"),
		window: input.config?.window ?? "MovingStanzaWindow",
		weightBy: input.config?.weightBy ?? "binary",
		windowSizeBack: input.config?.windowSizeBack ?? 4,
		windowSizeForward: input.config?.windowSizeForward ?? 0,
		centerAlignToOrigin: input.config?.centerAlignToOrigin ?? true
	};
}
function resolveLimits$2(input) {
	const issues = [];
	const entries = Object.keys(DEFAULT_ANALYSIS_LIMITS);
	const resolved = {};
	for (const key of entries) {
		const requested = input.limits?.[key];
		if (requested !== void 0 && (!Number.isSafeInteger(requested) || requested < 1)) {
			issues.push(issue$1("INVALID_RESOURCE_LIMIT", `limits.${key}`, "must be a positive safe integer"));
			continue;
		}
		if (requested !== void 0 && requested > HARD_ANALYSIS_LIMITS[key]) {
			issues.push(issue$1("RESOURCE_LIMIT_ABOVE_HARD_CEILING", `limits.${key}`, `must not exceed ${HARD_ANALYSIS_LIMITS[key]}`));
			continue;
		}
		resolved[key] = requested ?? DEFAULT_ANALYSIS_LIMITS[key];
	}
	if (issues.length > 0) throw new AnalysisValidationError(issues);
	return resolved;
}
function validateColumnList(name, columns, minimum, issues) {
	if (!Array.isArray(columns) || columns.length < minimum) {
		issues.push(issue$1("INVALID_COLUMN_MAPPING", `mapping.${name}`, `must contain at least ${minimum} column${minimum === 1 ? "" : "s"}`));
		return [];
	}
	const result = [];
	const seen = /* @__PURE__ */ new Set();
	columns.forEach((column, index) => {
		if (typeof column !== "string" || column.trim() === "") {
			issues.push(issue$1("INVALID_COLUMN_NAME", `mapping.${name}[${index}]`, "must be a non-empty string"));
			return;
		}
		if (seen.has(column)) {
			issues.push(issue$1("DUPLICATE_COLUMN", `mapping.${name}[${index}]`, `duplicates ${JSON.stringify(column)}`));
			return;
		}
		seen.add(column);
		result.push(column);
	});
	return result;
}
function validateMapping$1(mapping, config, limits) {
	const issues = [];
	const units = validateColumnList("units", mapping.units, 1, issues);
	const conversation = validateColumnList("conversation", mapping.conversation, 1, issues);
	const codes = validateColumnList("codes", mapping.codes, 3, issues);
	const metadata = mapping.metadata === void 0 ? [] : validateColumnList("metadata", mapping.metadata, 0, issues);
	const roleSets = [
		["units", units],
		["conversation", conversation],
		["codes", codes],
		["metadata", metadata]
	];
	const owners = /* @__PURE__ */ new Map();
	for (const [role, columns] of roleSets) for (const column of columns) {
		const previous = owners.get(column);
		if (previous) issues.push(issue$1("OVERLAPPING_COLUMN_ROLES", `mapping.${role}`, `${JSON.stringify(column)} is already mapped as ${previous}`));
		else owners.set(column, role);
	}
	for (const reserved of [
		INTERNAL_UNIT_COLUMN,
		INTERNAL_CONVERSATION_COLUMN,
		INTERNAL_SOURCE_ROW_OCCURRENCE_COLUMN
	]) if (owners.has(reserved)) issues.push(issue$1("RESERVED_COLUMN", "mapping", `${JSON.stringify(reserved)} is reserved by @3dena/analysis`));
	const edgeCount = codes.length * (codes.length - 1) / 2;
	if (codes.length > limits.maxCodes) issues.push(issue$1("CODE_LIMIT_EXCEEDED", "mapping.codes", `${codes.length} exceeds maxCodes=${limits.maxCodes}`));
	if (edgeCount > limits.maxEdges) issues.push(issue$1("EDGE_LIMIT_EXCEEDED", "mapping.codes", `${edgeCount} implied edges exceeds maxEdges=${limits.maxEdges}`));
	if (![
		"EndPoint",
		"AccumulatedTrajectory",
		"SeparateTrajectory"
	].includes(config.model)) issues.push(issue$1("INVALID_MODEL", "config.model", "must be EndPoint, AccumulatedTrajectory, or SeparateTrajectory"));
	if (!["MovingStanzaWindow", "Conversation"].includes(config.window)) issues.push(issue$1("INVALID_WINDOW", "config.window", "must be MovingStanzaWindow or Conversation"));
	if (!["binary", "sum"].includes(config.weightBy)) issues.push(issue$1("INVALID_WEIGHT", "config.weightBy", "must be binary or sum"));
	if (!Number.isInteger(config.windowSizeBack) || config.windowSizeBack < 0) issues.push(issue$1("INVALID_WINDOW", "config.windowSizeBack", "must be a non-negative integer"));
	if (!Number.isInteger(config.windowSizeForward) || config.windowSizeForward < 0) issues.push(issue$1("INVALID_WINDOW", "config.windowSizeForward", "must be a non-negative integer"));
	if (typeof config.centerAlignToOrigin !== "boolean") issues.push(issue$1("INVALID_CENTERING", "config.centerAlignToOrigin", "must be boolean"));
	const trajectory = mapping.trajectory;
	if (trajectory) {
		if (config.model === "EndPoint") issues.push(issue$1("TRAJECTORY_MODEL_REQUIRED", "config.model", "trajectory mapping requires AccumulatedTrajectory or SeparateTrajectory"));
		const participants = validateColumnList("trajectory.participant", trajectory.participant, 1, issues);
		for (const participant of participants) if (!units.includes(participant)) issues.push(issue$1("PARTICIPANT_NOT_UNIT", "mapping.trajectory.participant", `${JSON.stringify(participant)} must also occur in mapping.units`));
		if (!units.includes(trajectory.group)) issues.push(issue$1("GROUP_NOT_UNIT", "mapping.trajectory.group", "group must also occur in mapping.units so it is unit-stable"));
		if (!conversation.includes(trajectory.time)) issues.push(issue$1("TIME_NOT_CONVERSATION", "mapping.trajectory.time", "time must also occur in mapping.conversation"));
		if (trajectory.cohortPolicy !== void 0 && trajectory.cohortPolicy !== "available" && trajectory.cohortPolicy !== "complete") issues.push(issue$1("INVALID_COHORT_POLICY", "mapping.trajectory.cohortPolicy", "must be available or complete"));
		if (trajectory.timeOrder !== void 0 && !Array.isArray(trajectory.timeOrder)) issues.push(issue$1("INVALID_TIME_ORDER", "mapping.trajectory.timeOrder", "must be an array when provided"));
		else if (trajectory.timeOrder) {
			const seen = /* @__PURE__ */ new Set();
			trajectory.timeOrder.forEach((value, index) => {
				if (!isRawScalar(value) || value === null || typeof value === "number" && !Number.isFinite(value)) {
					issues.push(issue$1("INVALID_TIME_ORDER", `mapping.trajectory.timeOrder[${index}]`, "must be a non-null finite scalar"));
					return;
				}
				const key = canonicalScalars([value]);
				if (seen.has(key)) issues.push(issue$1("DUPLICATE_TIME", `mapping.trajectory.timeOrder[${index}]`, "duplicates an earlier typed period value"));
				seen.add(key);
			});
		}
	}
	if (issues.length > 0) throw new AnalysisValidationError(issues);
}
function validateIdentityValue(value, path) {
	if (value === null || value === "") throw new AnalysisValidationError([issue$1("MISSING_IDENTITY", path, "identity values must not be null or empty")]);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new AnalysisValidationError([issue$1("NON_FINITE_IDENTITY", path, "identity numbers must be finite")]);
		if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new AnalysisValidationError([issue$1("UNSAFE_INTEGER_IDENTITY", path, "integers above Number.MAX_SAFE_INTEGER must be supplied as strings")]);
	}
}
function stableRowValue(previous, current) {
	return canonicalScalars([previous]) === canonicalScalars([current]);
}
function prepareAnalysisInput(input) {
	if (!input || typeof input !== "object") throw new AnalysisValidationError([issue$1("INVALID_INPUT", "input", "must be an object")]);
	if (!Array.isArray(input.rows) || input.rows.length === 0) throw new AnalysisValidationError([issue$1("EMPTY_ROWS", "rows", "must contain at least one row")]);
	if (!input.mapping || typeof input.mapping !== "object") throw new AnalysisValidationError([issue$1("INVALID_MAPPING", "mapping", "must be an object")]);
	validateEnvelopeShape(input);
	const limits = resolveLimits$2(input);
	const config = normalizedConfig(input);
	validateMapping$1(input.mapping, config, limits);
	if (input.rows.length > limits.maxRows) throw new AnalysisValidationError([issue$1("ROW_LIMIT_EXCEEDED", "rows", `${input.rows.length} exceeds maxRows=${limits.maxRows}`)]);
	const requiredColumns = [
		...input.mapping.units,
		...input.mapping.conversation,
		...input.mapping.codes,
		...input.mapping.metadata ?? []
	];
	const inputColumnSet = /* @__PURE__ */ new Set();
	const unitContexts = /* @__PURE__ */ new Map();
	const conversationContexts = /* @__PURE__ */ new Map();
	const normalizedRows = [];
	const observedGroups = /* @__PURE__ */ new Set();
	const observedTimes = /* @__PURE__ */ new Set();
	const predictedPointKeys = /* @__PURE__ */ new Set();
	input.rows.forEach((candidate, rowIndex) => {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new AnalysisValidationError([issue$1("INVALID_ROW", `rows[${rowIndex}]`, "must be a scalar record")]);
		const row = candidate;
		for (const [column, value] of Object.entries(row)) {
			inputColumnSet.add(column);
			if (!isRawScalar(value)) throw new AnalysisValidationError([issue$1("NON_SCALAR_VALUE", `rows[${rowIndex}].${column}`, "must be string, number, boolean, or null")]);
			if (typeof value === "number" && !Number.isFinite(value)) throw new AnalysisValidationError([issue$1("NON_FINITE_VALUE", `rows[${rowIndex}].${column}`, "must be finite")]);
			if (typeof value === "string" && value.length > limits.maxStringLength) throw new AnalysisValidationError([issue$1("STRING_LIMIT_EXCEEDED", `rows[${rowIndex}].${column}`, `length exceeds maxStringLength=${limits.maxStringLength}`)]);
		}
		for (const column of requiredColumns) if (!Object.hasOwn(row, column)) throw new AnalysisValidationError([issue$1("MISSING_COLUMN", `rows[${rowIndex}].${column}`, "required mapped column is missing")]);
		for (const column of [...input.mapping.units, ...input.mapping.conversation]) validateIdentityValue(row[column] ?? null, `rows[${rowIndex}].${column}`);
		const unit = entityKey(row, input.mapping.units);
		const step = entityKey(row, input.mapping.conversation);
		predictedPointKeys.add(config.model === "EndPoint" ? unit.canonical : JSON.stringify([unit.canonical, step.canonical]));
		const participantLabel = entityKey(row, input.mapping.trajectory?.participant ?? input.mapping.units);
		const group = input.mapping.trajectory ? typedValue$2(row[input.mapping.trajectory.group] ?? null) : void 0;
		const time = input.mapping.trajectory ? typedValue$2(row[input.mapping.trajectory.time] ?? null) : void 0;
		if (group) observedGroups.add(group.canonical);
		if (time) observedTimes.add(time.canonical);
		const metadata = Object.fromEntries((input.mapping.metadata ?? []).map((column) => [column, row[column] ?? null]));
		const previousUnit = unitContexts.get(unit.canonical);
		if (previousUnit) {
			for (const [column, value] of Object.entries(metadata)) if (!stableRowValue(previousUnit.metadata[column] ?? null, value)) throw new AnalysisValidationError([issue$1("UNSTABLE_UNIT_METADATA", `rows[${rowIndex}].${column}`, "metadata declared as unit-level must be constant within the complete typed unit")]);
		} else unitContexts.set(unit.canonical, {
			unit,
			participantLabel,
			...group ? { group } : {},
			metadata
		});
		const previousConversation = conversationContexts.get(step.canonical);
		if (previousConversation?.time && time && previousConversation.time.canonical !== time.canonical) throw new AnalysisValidationError([issue$1("AMBIGUOUS_CONVERSATION_TIME", `rows[${rowIndex}]`, "the same typed conversation tuple maps to multiple periods")]);
		if (!previousConversation) conversationContexts.set(step.canonical, {
			step,
			...time ? { time } : {}
		});
		normalizedRows.push({
			[INTERNAL_UNIT_COLUMN]: unit.canonical,
			[INTERNAL_CONVERSATION_COLUMN]: step.canonical,
			...Object.fromEntries(input.mapping.codes.map((column) => [column, normalizeCode(row[column] ?? null, `rows[${rowIndex}].${column}`)]))
		});
	});
	const inputColumns = [...inputColumnSet].sort();
	if (inputColumns.length > limits.maxColumns) throw new AnalysisValidationError([issue$1("COLUMN_LIMIT_EXCEEDED", "rows", `${inputColumns.length} exceeds maxColumns=${limits.maxColumns}`)]);
	const cells = input.rows.length * inputColumns.length;
	if (!Number.isSafeInteger(cells) || cells > limits.maxCells) throw new AnalysisValidationError([issue$1("CELL_LIMIT_EXCEEDED", "rows", `${cells} exceeds maxCells=${limits.maxCells}`)]);
	const edgeCount = input.mapping.codes.length * (input.mapping.codes.length - 1) / 2;
	if (edgeCount > limits.maxDimensions) throw new AnalysisValidationError([issue$1("DIMENSION_LIMIT_EXCEEDED", "mapping.codes", `${edgeCount} modeled dimensions exceeds maxDimensions=${limits.maxDimensions}`)]);
	const coordinateCells = (predictedPointKeys.size + input.mapping.codes.length) * edgeCount;
	if (!Number.isSafeInteger(coordinateCells) || coordinateCells > limits.maxCoordinateCells) throw new AnalysisValidationError([issue$1("COORDINATE_CELL_LIMIT_EXCEEDED", "rows", `${coordinateCells} retained point/node coordinate cells exceeds maxCoordinateCells=${limits.maxCoordinateCells}`)]);
	const accumulationCells = predictedPointKeys.size * edgeCount + input.rows.length * (input.mapping.codes.length + edgeCount);
	if (!Number.isSafeInteger(accumulationCells) || accumulationCells > limits.maxAccumulationCells) throw new AnalysisValidationError([issue$1("ACCUMULATION_CELL_LIMIT_EXCEEDED", "rows", `${accumulationCells} implied public accumulation cells exceeds maxAccumulationCells=${limits.maxAccumulationCells}`)]);
	if (unitContexts.size > limits.maxUnits) throw new AnalysisValidationError([issue$1("UNIT_LIMIT_EXCEEDED", "rows", `${unitContexts.size} exceeds maxUnits=${limits.maxUnits}`)]);
	if (predictedPointKeys.size > limits.maxOutputPoints) throw new AnalysisValidationError([issue$1("OUTPUT_POINT_LIMIT_EXCEEDED", "rows", `${predictedPointKeys.size} implied model points exceeds maxOutputPoints=${limits.maxOutputPoints}`)]);
	if (observedGroups.size > limits.maxGroups) throw new AnalysisValidationError([issue$1("GROUP_LIMIT_EXCEEDED", "rows", `${observedGroups.size} exceeds maxGroups=${limits.maxGroups}`)]);
	if (observedTimes.size > limits.maxTimePoints) throw new AnalysisValidationError([issue$1("TIME_LIMIT_EXCEEDED", "rows", `${observedTimes.size} exceeds maxTimePoints=${limits.maxTimePoints}`)]);
	if (input.mapping.trajectory?.timeOrder) {
		const expected = new Set(input.mapping.trajectory.timeOrder.map((value) => canonicalScalars([value])));
		if ([...observedTimes].filter((key) => !expected.has(key)).length > 0) throw new AnalysisValidationError([issue$1("TIME_ORDER_INCOMPLETE", "mapping.trajectory.timeOrder", "must include every observed typed period value")]);
		if (input.mapping.trajectory.timeOrder.length > limits.maxTimePoints) throw new AnalysisValidationError([issue$1("TIME_LIMIT_EXCEEDED", "mapping.trajectory.timeOrder", `length exceeds maxTimePoints=${limits.maxTimePoints}`)]);
	}
	const diagnostics = [];
	if (config.window === "Conversation" && (input.config?.windowSizeBack !== void 0 || input.config?.windowSizeForward !== void 0)) diagnostics.push({
		code: "CONVERSATION_WINDOW_IGNORES_STANZA_SIZE",
		severity: "info",
		message: "Conversation windows use the complete conversation; stanza back/forward sizes do not alter accumulation.",
		path: "config.window"
	});
	return {
		rows: normalizedRows,
		mapping: input.mapping,
		config,
		limits,
		inputColumns,
		unitContexts,
		conversationContexts,
		diagnostics
	};
}
var INTERNAL_UNIT_COLUMN, INTERNAL_CONVERSATION_COLUMN, INTERNAL_SOURCE_ROW_OCCURRENCE_COLUMN, DEFAULT_ANALYSIS_LIMITS, HARD_ANALYSIS_LIMITS;
var init_validation = __esmMin((() => {
	init_types();
	INTERNAL_UNIT_COLUMN = "__3dena_unit_key_v1";
	INTERNAL_CONVERSATION_COLUMN = "__3dena_conversation_key_v1";
	INTERNAL_SOURCE_ROW_OCCURRENCE_COLUMN = "@3dena/source-row-occurrence";
	DEFAULT_ANALYSIS_LIMITS = Object.freeze({
		maxRows: 1e5,
		maxColumns: 256,
		maxCells: 5e6,
		maxAccumulationCells: 5e6,
		maxCodes: 64,
		maxEdges: 2016,
		maxStringLength: 32768,
		maxUnits: 5e4,
		maxGroups: 200,
		maxTimePoints: 512,
		maxOutputPoints: 1e5,
		maxDimensions: 200,
		maxCoordinateCells: 5e6
	});
	HARD_ANALYSIS_LIMITS = Object.freeze({
		maxRows: 5e5,
		maxColumns: 1024,
		maxCells: 2e7,
		maxAccumulationCells: 2e7,
		maxCodes: 128,
		maxEdges: 8128,
		maxStringLength: 1e6,
		maxUnits: 2e5,
		maxGroups: 1e3,
		maxTimePoints: 1e4,
		maxOutputPoints: 5e5,
		maxDimensions: 500,
		maxCoordinateCells: 2e7
	});
}));
//#endregion
//#region packages/analysis/src/trajectory.ts
function meanCoordinates(points) {
	if (points.length === 0) return [
		0,
		0,
		0
	];
	const sums = [
		0,
		0,
		0
	];
	for (const point of points) {
		sums[0] += point[0];
		sums[1] += point[1];
		sums[2] += point[2];
	}
	return [
		sums[0] / points.length,
		sums[1] / points.length,
		sums[2] / points.length
	];
}
function meanCoordinatesND(points, dimensions) {
	if (points.length === 0) return Array.from({ length: dimensions }, () => 0);
	return Array.from({ length: dimensions }, (_, dimension) => points.reduce((sum, point) => sum + (point[dimension] ?? 0), 0) / points.length);
}
function stableTypedValues(values) {
	const seen = /* @__PURE__ */ new Set();
	return values.filter((value) => {
		if (seen.has(value.canonical)) return false;
		seen.add(value.canonical);
		return true;
	});
}
function participantPeriodKey(point) {
	return JSON.stringify([point.unit.canonical, point.time?.canonical]);
}
function participantInCompleteCohort(point, periodsByGroupParticipant, expectedTimeKeys) {
	const key = JSON.stringify([point.group.canonical, point.participant.canonical]);
	const periods = periodsByGroupParticipant.get(key);
	if (!periods || periods.size !== expectedTimeKeys.size) return false;
	for (const expected of expectedTimeKeys) if (!periods.has(expected)) return false;
	return true;
}
function buildSharedSpaceTrajectories(points, mapping, dimensions) {
	const eligible = points.filter((point) => point.group && point.time);
	if (eligible.length !== points.length) throw new Error("Trajectory construction requires a typed group and period on every model point.");
	const groupOrder = stableTypedValues(eligible.map((point) => point.group));
	const inferredTimeOrder = stableTypedValues(eligible.map((point) => point.time));
	const timeOrder = mapping.timeOrder?.map(typedValue$2) ?? inferredTimeOrder;
	const timeKeys = new Set(timeOrder.map((time) => time.canonical));
	const reductions = /* @__PURE__ */ new Map();
	for (const point of eligible) {
		const group = point.group;
		const time = point.time;
		if (!timeKeys.has(time.canonical)) throw new Error(`Observed period ${time.display} is absent from the validated time order.`);
		const key = participantPeriodKey(point);
		const current = reductions.get(key);
		if (current) {
			if (current.group.canonical !== group.canonical) throw new Error("A typed participant-period maps to multiple groups.");
			current.sums[0] += point.coordinates[0];
			current.sums[1] += point.coordinates[1];
			current.sums[2] += point.coordinates[2];
			if (current.fullSums.length !== point.fullCoordinates.length) throw new Error("Trajectory points do not share one full-dimensional rotation shape.");
			point.fullCoordinates.forEach((value, dimension) => {
				current.fullSums[dimension] = (current.fullSums[dimension] ?? 0) + value;
			});
			current.sourcePointIndexes.push(point.index);
		} else reductions.set(key, {
			participant: point.unit,
			participantLabel: point.participantLabel,
			group,
			time,
			sourcePointIndexes: [point.index],
			sums: [...point.coordinates],
			fullSums: [...point.fullCoordinates]
		});
	}
	const participantPeriods = [...reductions.values()].map((reduction, index) => ({
		index,
		participant: reduction.participant,
		participantLabel: reduction.participantLabel,
		group: reduction.group,
		time: reduction.time,
		coordinates: [
			reduction.sums[0] / reduction.sourcePointIndexes.length,
			reduction.sums[1] / reduction.sourcePointIndexes.length,
			reduction.sums[2] / reduction.sourcePointIndexes.length
		],
		fullCoordinates: reduction.fullSums.map((value) => value / reduction.sourcePointIndexes.length),
		sourcePointIndexes: reduction.sourcePointIndexes,
		includedInCohort: true
	}));
	const cohortPolicy = mapping.cohortPolicy ?? "available";
	if (cohortPolicy === "complete") {
		const periodsByGroupParticipant = /* @__PURE__ */ new Map();
		for (const point of participantPeriods) {
			const key = JSON.stringify([point.group.canonical, point.participant.canonical]);
			const periods = periodsByGroupParticipant.get(key) ?? /* @__PURE__ */ new Set();
			periods.add(point.time.canonical);
			periodsByGroupParticipant.set(key, periods);
		}
		for (const point of participantPeriods) point.includedInCohort = participantInCompleteCohort(point, periodsByGroupParticipant, timeKeys);
	}
	const centroids = [];
	const centroidIndexByGroupTime = /* @__PURE__ */ new Map();
	for (const group of groupOrder) for (const time of timeOrder) {
		const members = participantPeriods.filter((point) => point.includedInCohort && point.group.canonical === group.canonical && point.time.canonical === time.canonical);
		if (members.length === 0) continue;
		const index = centroids.length;
		const centroid = {
			index,
			group,
			time,
			coordinates: meanCoordinates(members.map((member) => member.coordinates)),
			fullCoordinates: meanCoordinatesND(members.map((member) => member.fullCoordinates), dimensions.length),
			participantCount: members.length,
			participantPeriodIndexes: members.map((member) => member.index)
		};
		centroids.push(centroid);
		centroidIndexByGroupTime.set(JSON.stringify([group.canonical, time.canonical]), index);
	}
	const paths = groupOrder.map((group) => ({
		group,
		steps: timeOrder.map((time) => ({
			time,
			centroidIndex: centroidIndexByGroupTime.get(JSON.stringify([group.canonical, time.canonical])) ?? null
		}))
	}));
	return {
		space: "analysis-result-rotation",
		dimensions: [...dimensions],
		cohortPolicy,
		groupOrder,
		timeOrder,
		participantPeriods,
		centroids,
		paths
	};
}
var init_trajectory = __esmMin((() => {
	init_validation();
}));
//#endregion
//#region packages/analysis/src/analyze.ts
var analyze_exports = /* @__PURE__ */ __exportAll({ analyzeRows: () => analyzeRows });
function finiteNumber$1(value, path) {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric)) throw new Error(`jENA returned a non-finite number at ${path}.`);
	return numeric;
}
function coordinates(row, path, diagnostics) {
	return AXES.map((axis) => {
		if (!Object.hasOwn(row, axis)) {
			if (!diagnostics.some((diagnostic) => diagnostic.code === "MISSING_DISPLAY_AXIS" && diagnostic.path === axis)) diagnostics.push({
				code: "MISSING_DISPLAY_AXIS",
				severity: "warning",
				message: `${axis} was unavailable from jENA and was padded with zero.`,
				path: axis
			});
			return 0;
		}
		return finiteNumber$1(row[axis], `${path}.${axis}`);
	});
}
function fullCoordinates(row, dimensions, path) {
	return dimensions.map((dimension) => {
		if (!Object.hasOwn(row, dimension)) throw new Error(`jENA omitted modeled dimension ${JSON.stringify(dimension)} at ${path}.`);
		return finiteNumber$1(row[dimension], `${path}.${dimension}`);
	});
}
function combinedPointKey(unit, step) {
	if (!step) return unit;
	const values = [...unit.values, ...step.values];
	return {
		canonical: canonicalScalars(values),
		display: values.map(displayScalar$1).join(" · "),
		columns: [...unit.columns, ...step.columns],
		values
	};
}
function ensureUniqueColumns(columns, path) {
	if (new Set(columns).size !== columns.length) throw new Error(`${path} contains duplicate column names; code and edge labels must be unambiguous.`);
}
function countValues(row, columns, path) {
	return columns.map((column) => finiteNumber$1(row[column], `${path}.${column}`));
}
function emittedRowKey(row, prepared, index) {
	const unitKey = String(row["__3dena_unit_key_v1"] ?? "");
	const conversationKey = String(row["__3dena_conversation_key_v1"] ?? "");
	const unitContext = prepared.unitContexts.get(unitKey);
	const conversationContext = prepared.conversationContexts.get(conversationKey);
	if (!unitContext) throw new Error(`jENA row count ${index} has an unknown typed unit key.`);
	if (!conversationContext) throw new Error(`jENA row count ${index} has an unknown typed conversation key.`);
	return combinedPointKey(unitContext.unit, conversationContext.step);
}
function disambiguateRowKeys(baseKeys) {
	const frequencies = /* @__PURE__ */ new Map();
	for (const key of baseKeys) frequencies.set(key.canonical, (frequencies.get(key.canonical) ?? 0) + 1);
	const occurrences = /* @__PURE__ */ new Map();
	return baseKeys.map((key) => {
		if ((frequencies.get(key.canonical) ?? 0) === 1) return key;
		const occurrence = (occurrences.get(key.canonical) ?? 0) + 1;
		occurrences.set(key.canonical, occurrence);
		const values = [...key.values, occurrence];
		return {
			canonical: canonicalScalars(values),
			display: `${key.display} · source row ${occurrence}`,
			columns: [...key.columns, INTERNAL_SOURCE_ROW_OCCURRENCE_COLUMN],
			values
		};
	});
}
function accumulationTables(set, prepared, points) {
	if (set.connectionCounts.length !== points.length) throw new Error(`jENA returned ${set.connectionCounts.length} model-count rows for ${points.length} aligned model points.`);
	const modelColumns = [...set.codeColumns];
	const rowColumns = [...prepared.mapping.codes, ...set.codeColumns];
	ensureUniqueColumns(modelColumns, "accumulation.modelCounts.columns");
	ensureUniqueColumns(rowColumns, "accumulation.rowCounts.columns");
	const modelCounts = {
		rowKeys: points.map((point) => point.id),
		columns: modelColumns,
		values: set.connectionCounts.map((row, index) => countValues(row, modelColumns, `connectionCounts[${index}]`))
	};
	const rowCounts = {
		rowKeys: disambiguateRowKeys(set.rowConnectionCounts.map((row, index) => emittedRowKey(row, prepared, index))),
		columns: rowColumns,
		values: set.rowConnectionCounts.map((row, index) => countValues(row, rowColumns, `rowConnectionCounts[${index}]`))
	};
	if (new Set(modelCounts.rowKeys.map((key) => key.canonical)).size !== modelCounts.rowKeys.length) throw new Error("jENA returned ambiguous duplicate model-count row identities.");
	if (new Set(rowCounts.rowKeys.map((key) => key.canonical)).size !== rowCounts.rowKeys.length) throw new Error("Public source-row occurrence keys remain ambiguous after disambiguation.");
	const cellCount = modelCounts.values.length * modelCounts.columns.length + rowCounts.values.length * rowCounts.columns.length;
	if (!Number.isSafeInteger(cellCount) || cellCount > prepared.limits.maxAccumulationCells) throw new Error(`jENA produced ${cellCount} public accumulation cells, exceeding maxAccumulationCells=${prepared.limits.maxAccumulationCells}.`);
	return {
		modelCounts,
		rowCounts
	};
}
function pointRows(set, prepared, dimensions, diagnostics) {
	if (set.points.length > prepared.limits.maxOutputPoints) throw new Error(`jENA produced ${set.points.length} points, exceeding maxOutputPoints=${prepared.limits.maxOutputPoints}.`);
	return set.points.map((row, index) => {
		const unitKey = String(row["__3dena_unit_key_v1"] ?? "");
		const unitContext = prepared.unitContexts.get(unitKey);
		if (!unitContext) throw new Error(`jENA point ${index} has an unknown typed unit key.`);
		const trajectoryRow = set.trajectories?.[index];
		const conversationKey = trajectoryRow ? String(trajectoryRow["__3dena_conversation_key_v1"] ?? "") : void 0;
		const conversationContext = conversationKey ? prepared.conversationContexts.get(conversationKey) : void 0;
		if (prepared.config.model !== "EndPoint" && !conversationContext) throw new Error(`jENA trajectory point ${index} has no matching typed conversation key.`);
		const lineWeightRow = set.lineWeights[index];
		if (!lineWeightRow) throw new Error(`jENA point ${index} has no aligned line-weight row.`);
		const step = conversationContext?.step;
		return {
			index,
			id: combinedPointKey(unitContext.unit, step),
			unit: unitContext.unit,
			participantLabel: unitContext.participantLabel,
			...step ? { step } : {},
			...unitContext.group ? { group: unitContext.group } : {},
			...conversationContext?.time ? { time: conversationContext.time } : {},
			coordinates: coordinates(row, `points[${index}]`, diagnostics),
			fullCoordinates: fullCoordinates(row, dimensions, `points[${index}]`),
			lineWeights: set.codeColumns.map((column) => finiteNumber$1(lineWeightRow[column], `lineWeights[${index}].${column}`)),
			metadata: { ...unitContext.metadata }
		};
	});
}
function nodeRows(set, dimensions, diagnostics) {
	return (set.rotation.nodes ?? []).map((row, index) => ({
		index,
		code: String(row.code ?? set.codes[index] ?? index),
		coordinates: coordinates(row, `nodes[${index}]`, diagnostics),
		fullCoordinates: fullCoordinates(row, dimensions, `nodes[${index}]`)
	}));
}
function edgeRows(set, points) {
	return set.adjacencyKey.map((entry, index) => {
		const weights = points.map((point) => point.lineWeights[index] ?? 0);
		return {
			index,
			id: `edge:${entry.sourceIndex}:${entry.targetIndex}`,
			column: entry.name,
			source: entry.source,
			target: entry.target,
			sourceIndex: entry.sourceIndex,
			targetIndex: entry.targetIndex,
			meanWeight: weights.length === 0 ? 0 : weights.reduce((sum, weight) => sum + weight, 0) / weights.length
		};
	});
}
function finiteMatrix(matrix, path) {
	return matrix.map((row, rowIndex) => row.map((value, columnIndex) => finiteNumber$1(value, `${path}[${rowIndex}][${columnIndex}]`)));
}
/**
* Runs the complete framework-independent 3D analysis synchronously.
*
* In browsers call this inside a dedicated module Worker. jENA's SVD stage is
* synchronous, so timeout/cancellation must hard-terminate that Worker; an
* AbortSignal here would promise a cancellation guarantee the core cannot make.
*/
function analyzeRows(input) {
	const prepared = prepareAnalysisInput(input);
	const requestedDimensions = prepared.mapping.codes.length * (prepared.mapping.codes.length - 1) / 2;
	const set = ena({
		rows: prepared.rows,
		units: [INTERNAL_UNIT_COLUMN],
		conversation: [INTERNAL_CONVERSATION_COLUMN],
		codes: [...prepared.mapping.codes],
		model: prepared.config.model,
		window: prepared.config.window,
		weightBy: prepared.config.weightBy,
		windowSizeBack: prepared.config.windowSizeBack,
		windowSizeForward: prepared.config.windowSizeForward,
		dimensions: requestedDimensions,
		centerAlignToOrigin: prepared.config.centerAlignToOrigin,
		rotation: { method: "svd" }
	});
	const diagnostics = [...prepared.diagnostics];
	const dimensions = [...set.rotation.rotationColumns];
	if (dimensions.length > prepared.limits.maxDimensions) throw new Error(`jENA returned ${dimensions.length} dimensions, exceeding maxDimensions=${prepared.limits.maxDimensions}.`);
	const coordinateCells = (set.points.length + (set.rotation.nodes?.length ?? 0)) * dimensions.length;
	if (!Number.isSafeInteger(coordinateCells) || coordinateCells > prepared.limits.maxCoordinateCells) throw new Error(`jENA returned ${coordinateCells} point/node coordinate cells, exceeding maxCoordinateCells=${prepared.limits.maxCoordinateCells}.`);
	const points = pointRows(set, prepared, dimensions, diagnostics);
	const nodes = nodeRows(set, dimensions, diagnostics);
	const edges = edgeRows(set, points);
	const accumulation = accumulationTables(set, prepared, points);
	const trajectory = prepared.mapping.trajectory ? buildSharedSpaceTrajectories(points, prepared.mapping.trajectory, dimensions) : void 0;
	diagnostics.push({
		code: "PARITY_SCOPE_NOT_ASSESSED",
		severity: "info",
		message: "A raw analysis result does not carry fixture-level parity evidence by itself. Assess exact dataset, specification, version, and build scope separately before making a candidate claim.",
		path: "provenance.legacyGoldenStatus"
	});
	const variance = set.rotation.rotationColumns.map((axis, rotationIndex) => {
		return {
			axis,
			proportion: finiteNumber$1(set.variance[axis] ?? 0, `variance.${axis}`),
			eigenvalue: finiteNumber$1(set.rotation.eigenvalues[rotationIndex] ?? 0, `rotation.eigenvalues[${rotationIndex}]`),
			displayed: AXES.includes(axis)
		};
	});
	return {
		schemaVersion: "3dena.analysis-result.v1",
		dimensions,
		axes: [...AXES],
		points,
		nodes,
		edges,
		accumulation,
		variance,
		rotation: {
			method: "svd",
			columns: [...set.rotation.rotationColumns],
			matrix: finiteMatrix(set.rotation.rotationMatrix, "rotation.matrix"),
			eigenvalues: set.rotation.eigenvalues.map((value, index) => finiteNumber$1(value, `rotation.eigenvalues[${index}]`)),
			centerVector: set.rotation.centerVector.map((value, index) => finiteNumber$1(value, `rotation.centerVector[${index}]`))
		},
		...trajectory ? { trajectory } : {},
		summary: {
			inputRows: input.rows.length,
			inputColumns: prepared.inputColumns.length,
			units: prepared.unitContexts.size,
			points: points.length,
			nodes: nodes.length,
			edges: edges.length,
			modelCountRows: accumulation.modelCounts.values.length,
			rowCountRows: accumulation.rowCounts.values.length,
			groups: trajectory?.groupOrder.length ?? 0,
			timePoints: trajectory?.timeOrder.length ?? 0,
			participantPeriods: trajectory?.participantPeriods.length ?? 0,
			trajectoryCentroids: trajectory?.centroids.length ?? 0,
			dimensions: dimensions.length
		},
		diagnostics,
		provenance: {
			adapter: "@3dena/analysis",
			adapterVersion: ANALYSIS_BUILD_IDENTITY.sdkVersion,
			jenaPackage: "jena-js",
			jenaVersion: ANALYSIS_BUILD_IDENTITY.jenaVersion,
			jenaCommit: ANALYSIS_BUILD_IDENTITY.jenaCommit,
			coreGoldenContract: "jena-package-golden-v1",
			legacyGoldenContract: "legacy-application-golden-v1",
			legacyGoldenStatus: "not-assessed",
			parityContract: "3dena.parity-contract.v1",
			resultSemantics: "one shared SVD rotation; participant-period reduction before group-time centroids",
			resolvedConfig: {
				...prepared.config,
				windowSizeBack: Number.isFinite(prepared.config.windowSizeBack) ? prepared.config.windowSizeBack : "Infinity"
			},
			resolvedLimits: { ...prepared.limits }
		}
	};
}
var AXES;
var init_analyze = __esmMin((() => {
	init_dist();
	init_build_identity();
	init_trajectory();
	init_validation();
	AXES = [
		"SVD1",
		"SVD2",
		"SVD3"
	];
}));
//#endregion
//#region packages/analysis/src/prepared-derived.ts
init_analyze();
var SHA256$4 = /^[a-f0-9]{64}$/u;
var PreparedDerivedAnalysisError = class extends Error {
	code;
	path;
	constructor(code, path, message) {
		super(`${path}: ${message}`);
		this.name = "PreparedDerivedAnalysisError";
		this.code = code;
		this.path = path;
	}
};
function reject$6(code, path, message) {
	throw new PreparedDerivedAnalysisError(code, path, message);
}
function finiteMean(values, path) {
	if (values.length === 0) reject$6("EMPTY_PREPARED_SELECTION", path, "contains no prepared points");
	const scale = values.reduce((maximum, value) => {
		if (!Number.isFinite(value)) reject$6("NON_FINITE_PREPARED_SOURCE", path, "contains a non-finite value");
		return Math.max(maximum, Math.abs(value));
	}, 0) || 1;
	let sum = 0;
	let correction = 0;
	for (const value of values) {
		const normalized = value / scale;
		const next = sum + normalized;
		if (Math.abs(sum) >= Math.abs(normalized)) correction += sum - next + normalized;
		else correction += normalized - next + sum;
		sum = next;
	}
	const mean = (sum + correction) / values.length * scale;
	if (!Number.isFinite(mean)) reject$6("PREPARED_NUMERIC_OVERFLOW", path, "mean is outside the finite numeric range");
	return mean;
}
function scalarCanonical(value, path = "selector.level") {
	if (value === null) return JSON.stringify(["null"]);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) reject$6("NON_FINITE_PREPARED_LEVEL", path, "must be finite");
		if (Number.isInteger(value) && !Number.isSafeInteger(value)) reject$6("UNSAFE_PREPARED_LEVEL", path, "unsafe integer identities must be supplied as source strings");
		if (Object.is(value, -0)) return JSON.stringify(["number", "-0"]);
	}
	return JSON.stringify([typeof value, value]);
}
function typedValue$1(value) {
	return {
		canonical: value.canonical,
		display: value.display,
		value: value.value
	};
}
/**
* Validates the immutable prepared reduction boundary without claiming that
* imported coordinates were recomputed from raw rows.
*/
function assertPreparedDerivedSource(result) {
	if (!result || typeof result !== "object" || result.schemaVersion !== "3dena.prepared-space-result.v1") reject$6("INVALID_PREPARED_SOURCE", "result.schemaVersion", "must be 3dena.prepared-space-result.v1");
	const provenance = result.provenance;
	if (result.sourceKind !== "prepared-exchange" || result.rawJenaRecompute !== false || !provenance || typeof provenance !== "object" || provenance.jenaExecuted !== false || provenance.coordinateSpace !== "precomputed-import" || provenance.computation !== "reduction-only") reject$6("INVALID_PREPARED_BOUNDARY", "result", "must remain a precomputed prepared exchange with jENA execution disabled");
	const sourceReceipt = result.sourceReceipt;
	if (!sourceReceipt || typeof sourceReceipt !== "object" || !SHA256$4.test(sourceReceipt.sha256) || !Number.isSafeInteger(sourceReceipt.byteLength) || sourceReceipt.byteLength < 1) reject$6("INVALID_PREPARED_RECEIPT", "result.sourceReceipt", "must contain an exact SHA-256 and positive byte length");
	const fullSpace = result.fullSpace;
	if (!fullSpace || typeof fullSpace !== "object") reject$6("INVALID_PREPARED_FULL_SPACE", "result.fullSpace", "must contain the imported full-space reduction");
	const { dimensions, points, edges, lineWeights } = fullSpace;
	if (!Array.isArray(dimensions) || dimensions.length === 0 || dimensions.some((dimension) => typeof dimension !== "string" || dimension.trim() === "")) reject$6("INVALID_PREPARED_DIMENSIONS", "result.fullSpace.dimensions", "must contain non-empty dimension names");
	if (new Set(dimensions).size !== dimensions.length) reject$6("DUPLICATE_PREPARED_DIMENSION", "result.fullSpace.dimensions", "must not contain duplicates");
	if (!Array.isArray(points) || points.length === 0) reject$6("EMPTY_PREPARED_POINT_SET", "result.fullSpace.points", "must not be empty");
	if (!Array.isArray(edges) || edges.length === 0) reject$6("EMPTY_PREPARED_EDGE_SET", "result.fullSpace.edges", "must not be empty");
	if (!lineWeights || typeof lineWeights !== "object" || !Array.isArray(lineWeights.rowKeys) || !Array.isArray(lineWeights.values) || !Array.isArray(lineWeights.columns) || lineWeights.rowKeys.length !== points.length || lineWeights.values.length !== points.length || lineWeights.columns.length !== edges.length) reject$6("MISALIGNED_PREPARED_LINE_WEIGHTS", "result.fullSpace.lineWeights", "row keys, values, columns, points, and edges must remain exactly aligned");
	const pointKeys = /* @__PURE__ */ new Set();
	points.forEach((point, index) => {
		if (!point || typeof point !== "object") reject$6("INVALID_PREPARED_POINT", `result.fullSpace.points[${index}]`, "must be an object");
		if (point.index !== index) reject$6("MISALIGNED_PREPARED_POINT_ORDER", `result.fullSpace.points[${index}].index`, "must equal its array position");
		if (typeof point.id?.canonical !== "string" || point.id.canonical.length === 0 || typeof point.participant?.canonical !== "string" || point.participant.canonical.length === 0 || typeof point.participantLabel?.canonical !== "string" || point.participantLabel.canonical.length === 0 || typeof point.group?.canonical !== "string" || point.group.canonical.length === 0 || typeof point.time?.canonical !== "string" || point.time.canonical.length === 0) reject$6("INVALID_PREPARED_POINT_IDENTITY", `result.fullSpace.points[${index}]`, "must preserve non-empty point, participant, label, group, and time identities");
		if (pointKeys.has(point.id.canonical)) reject$6("DUPLICATE_PREPARED_POINT_IDENTITY", `result.fullSpace.points[${index}].id`, "duplicates an earlier prepared point identity");
		pointKeys.add(point.id.canonical);
		if (!Array.isArray(point.coordinates) || point.coordinates.length !== dimensions.length || point.coordinates.some((value) => !Number.isFinite(value))) reject$6("INVALID_PREPARED_COORDINATES", `result.fullSpace.points[${index}].coordinates`, "must contain one finite value per dimension");
		if (lineWeights.rowKeys[index]?.canonical !== point.id.canonical) reject$6("MISALIGNED_PREPARED_IDENTITY", `result.fullSpace.lineWeights.rowKeys[${index}]`, "must match the exact point identity and order");
		const weights = lineWeights.values[index];
		if (!weights || weights.length !== edges.length || weights.some((value) => !Number.isFinite(value))) reject$6("INVALID_PREPARED_LINE_WEIGHT_ROW", `result.fullSpace.lineWeights.values[${index}]`, "must contain one finite value per edge");
	});
	const edgeKeys = /* @__PURE__ */ new Set();
	edges.forEach((edge, index) => {
		if (!edge || typeof edge !== "object" || typeof edge.id !== "string" || edge.id.length === 0 || typeof edge.column !== "string" || edge.column.length === 0) reject$6("INVALID_PREPARED_EDGE", `result.fullSpace.edges[${index}]`, "must preserve non-empty edge and column identities");
		if (edge.index !== index || lineWeights.columns[index] !== edge.column) reject$6("MISALIGNED_PREPARED_EDGE_ORDER", `result.fullSpace.edges[${index}]`, "must preserve imported edge and line-weight column order");
		const edgeKey = JSON.stringify([edge.id, edge.column]);
		if (edgeKeys.has(edgeKey)) reject$6("DUPLICATE_PREPARED_EDGE_IDENTITY", `result.fullSpace.edges[${index}]`, "duplicates an earlier prepared edge identity");
		edgeKeys.add(edgeKey);
	});
	if (!result.displaySpace?.trajectory || !Array.isArray(result.displaySpace.trajectory.groupOrder)) reject$6("INVALID_PREPARED_GROUP_ORDER", "result.displaySpace.trajectory.groupOrder", "must preserve the prepared canonical group inventory");
}
function preparedReductionDiagnostic() {
	return {
		code: "PREPARED_PRECOMPUTED_REDUCTION",
		severity: "info",
		message: "This task reduces imported prepared coordinates and line weights only; it does not execute jENA or establish raw-row parity.",
		path: "sourceKind"
	};
}
function preparedGroupValue(result, canonical, path) {
	if (typeof canonical !== "string" || canonical.trim() === "") reject$6("INVALID_PREPARED_GROUP", path, "must be a non-empty canonical group key");
	const value = result.displaySpace.trajectory.groupOrder.find((candidate) => candidate.canonical === canonical) ?? result.fullSpace.points.find((point) => point.group.canonical === canonical)?.group;
	if (!value) reject$6("UNKNOWN_PREPARED_GROUP", path, "is not present in the prepared result");
	return typedValue$1(value);
}
function preparedPointsForGroup(result, canonical, path) {
	preparedGroupValue(result, canonical, path);
	const points = result.fullSpace.points.filter((point) => point.group.canonical === canonical);
	if (points.length === 0) reject$6("EMPTY_PREPARED_GROUP", path, "contains no prepared points");
	return points;
}
function preparedDimensionIndex(result, dimension, path) {
	const index = result.fullSpace.dimensions.indexOf(dimension);
	if (index < 0) reject$6("UNKNOWN_PREPARED_DIMENSION", path, `is not present in the imported full space: ${JSON.stringify(dimension)}`);
	return index;
}
function rowIndexByPoint(result) {
	return new Map(result.fullSpace.lineWeights.rowKeys.map((key, index) => [key.canonical, index]));
}
function preparedEdgeMean(result, edge, points, rows) {
	return {
		index: edge.index,
		id: edge.id,
		column: edge.column,
		source: edge.source,
		target: edge.target,
		meanWeight: finiteMean(points.map((point) => {
			const row = rows.get(point.id.canonical);
			if (row === void 0) reject$6("MISSING_PREPARED_LINE_WEIGHT_ROW", `point.${point.id.canonical}`, "does not have an aligned line-weight row");
			return result.fullSpace.lineWeights.values[row][edge.index];
		}), `edges[${edge.index}]`)
	};
}
function preparedNetworkMean(result, points) {
	if (points.length === 0) reject$6("EMPTY_PREPARED_SELECTION", "selection", "contains no prepared points");
	const rows = rowIndexByPoint(result);
	return {
		pointCount: points.length,
		pointIndexes: points.map((point) => point.index),
		meanCoordinates: result.fullSpace.dimensions.map((_, dimensionIndex) => finiteMean(points.map((point) => point.coordinates[dimensionIndex]), `dimensions[${dimensionIndex}]`)),
		edges: result.fullSpace.edges.map((edge) => preparedEdgeMean(result, edge, points, rows))
	};
}
function comparePreparedGroupNetworks(result, groups) {
	assertPreparedDerivedSource(result);
	if (!Array.isArray(groups) || groups.length !== 2 || groups[0] === groups[1]) reject$6("INVALID_PREPARED_GROUP_PAIR", "groups", "must contain two different canonical groups");
	const groupA = preparedGroupValue(result, groups[0], "groups[0]");
	const groupB = preparedGroupValue(result, groups[1], "groups[1]");
	const meanA = preparedNetworkMean(result, preparedPointsForGroup(result, groupA.canonical, "groups[0]"));
	const meanB = preparedNetworkMean(result, preparedPointsForGroup(result, groupB.canonical, "groups[1]"));
	return {
		schemaVersion: "3dena.network-comparison.v1",
		direction: "group-a-minus-group-b",
		groupA,
		groupB,
		meanA,
		meanB,
		differenceEdges: meanA.edges.map((edgeA, index) => {
			const edgeB = meanB.edges[index];
			const difference = edgeA.meanWeight - edgeB.meanWeight;
			return {
				...edgeA,
				meanWeight: difference,
				groupAMeanWeight: edgeA.meanWeight,
				groupBMeanWeight: edgeB.meanWeight,
				semanticOwner: difference > 0 ? "group-a" : difference < 0 ? "group-b" : "equal"
			};
		}),
		diagnostics: [preparedReductionDiagnostic(), {
			code: "PREPARED_CONFIDENCE_BOX_WITHHELD",
			severity: "warning",
			message: "No prepared-space confidence-box authority is configured; this comparison reports exact descriptive mean differences only.",
			path: "confidenceBox"
		}]
	};
}
function selectedValue(point, field) {
	if (field === "@group") return point.group.value;
	if (field === "@time") return point.time.value;
	return point.metadata[field];
}
function analyzePreparedChangeNetwork(result, selector) {
	assertPreparedDerivedSource(result);
	if (!selector || typeof selector.field !== "string" || selector.field.trim() === "") reject$6("INVALID_PREPARED_CHANGE_FIELD", "selector.field", "must be a non-empty metadata column name, @group, or @time");
	const levelCanonical = scalarCanonical(selector.level);
	const selected = result.fullSpace.points.filter((point) => {
		const value = selectedValue(point, selector.field);
		return value !== void 0 && scalarCanonical(value) === levelCanonical;
	});
	if (selected.length === 0) reject$6("UNKNOWN_PREPARED_CHANGE_LEVEL", "selector.level", "does not select any prepared points");
	return {
		schemaVersion: "3dena.change-network.v1",
		selector: {
			field: selector.field,
			level: selector.level
		},
		levelCanonical,
		mean: preparedNetworkMean(result, selected),
		diagnostics: [preparedReductionDiagnostic(), {
			code: "PREPARED_CHANGE_INFERENCE_WITHHELD",
			severity: "warning",
			message: "This is one exact prepared level-network reduction; it is not a longitudinal contrast and carries no inferential interval.",
			path: "selector"
		}]
	};
}
//#endregion
//#region packages/analysis/src/scientific-result-schemas.ts
var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
var HASH_SCHEMA$1 = {
	type: "string",
	pattern: "^[a-f0-9]{64}$"
};
var NON_EMPTY_STRING_SCHEMA$1 = {
	type: "string",
	minLength: 1
};
var FINITE_NUMBER_SCHEMA = { type: "number" };
var PROBABILITY_SCHEMA = {
	type: "number",
	minimum: 0,
	maximum: 1
};
var SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1 = {
	type: "integer",
	minimum: 0,
	maximum: MAX_SAFE_INTEGER
};
var SAFE_POSITIVE_INTEGER_SCHEMA$1 = {
	type: "integer",
	minimum: 1,
	maximum: MAX_SAFE_INTEGER
};
var UINT32_SCHEMA = {
	type: "integer",
	minimum: 0,
	maximum: 4294967295
};
var DURATION_UNITS$1 = [
	"milliseconds",
	"seconds",
	"minutes",
	"hours",
	"days",
	"weeks"
];
var PREPARED_COLUMN_TYPES = [
	"logical",
	"integer",
	"double",
	"character",
	"date",
	"datetime",
	"difftime",
	"factor",
	"ordered"
];
function exactObject(required, properties) {
	return {
		type: "object",
		additionalProperties: false,
		required: [...required],
		properties
	};
}
function arrayOf(items, options = {}) {
	return {
		type: "array",
		items,
		...options
	};
}
function nullable(schema) {
	return { oneOf: [{ type: "null" }, schema] };
}
function vector(length) {
	return arrayOf(FINITE_NUMBER_SCHEMA, length === void 0 ? { minItems: 1 } : {
		minItems: length,
		maxItems: length
	});
}
function constObject(values) {
	return exactObject(Object.keys(values), Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { const: value }])));
}
function countObject(fields, positive = false) {
	return exactObject(fields, Object.fromEntries(fields.map((field) => [field, positive ? SAFE_POSITIVE_INTEGER_SCHEMA$1 : SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1])));
}
var RAW_SCALAR_SCHEMA$1 = { oneOf: [
	{ type: "null" },
	{ type: "string" },
	{ type: "boolean" },
	{
		type: "integer",
		minimum: -MAX_SAFE_INTEGER,
		maximum: MAX_SAFE_INTEGER
	},
	{
		type: "number",
		not: { type: "integer" }
	}
] };
var RAW_ENTITY_KEY_SCHEMA = exactObject([
	"canonical",
	"display",
	"columns",
	"values"
], {
	canonical: NON_EMPTY_STRING_SCHEMA$1,
	display: { type: "string" },
	columns: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	}),
	values: arrayOf(RAW_SCALAR_SCHEMA$1, { minItems: 1 })
});
var RAW_TYPED_VALUE_SCHEMA = exactObject([
	"canonical",
	"display",
	"value"
], {
	canonical: NON_EMPTY_STRING_SCHEMA$1,
	display: { type: "string" },
	value: RAW_SCALAR_SCHEMA$1
});
var DIAGNOSTICS_SCHEMA = arrayOf(exactObject([
	"code",
	"severity",
	"message"
], {
	code: NON_EMPTY_STRING_SCHEMA$1,
	severity: { enum: ["info", "warning"] },
	message: NON_EMPTY_STRING_SCHEMA$1,
	path: NON_EMPTY_STRING_SCHEMA$1,
	count: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1
}));
var ANALYSIS_EDGE_SCHEMA = exactObject([
	"index",
	"id",
	"column",
	"source",
	"target",
	"sourceIndex",
	"targetIndex",
	"meanWeight"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	id: NON_EMPTY_STRING_SCHEMA$1,
	column: NON_EMPTY_STRING_SCHEMA$1,
	source: NON_EMPTY_STRING_SCHEMA$1,
	target: NON_EMPTY_STRING_SCHEMA$1,
	sourceIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	targetIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	meanWeight: FINITE_NUMBER_SCHEMA
});
var ANALYSIS_NODE_SCHEMA = exactObject([
	"index",
	"code",
	"coordinates",
	"fullCoordinates"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	code: NON_EMPTY_STRING_SCHEMA$1,
	coordinates: vector(3),
	fullCoordinates: vector()
});
var ANALYSIS_POINT_SCHEMA = exactObject([
	"index",
	"id",
	"unit",
	"participantLabel",
	"coordinates",
	"fullCoordinates",
	"lineWeights",
	"metadata"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	id: RAW_ENTITY_KEY_SCHEMA,
	unit: RAW_ENTITY_KEY_SCHEMA,
	participantLabel: RAW_ENTITY_KEY_SCHEMA,
	step: RAW_ENTITY_KEY_SCHEMA,
	group: RAW_TYPED_VALUE_SCHEMA,
	time: RAW_TYPED_VALUE_SCHEMA,
	coordinates: vector(3),
	fullCoordinates: vector(),
	lineWeights: vector(),
	metadata: {
		type: "object",
		additionalProperties: RAW_SCALAR_SCHEMA$1
	}
});
var ACCUMULATION_TABLE_SCHEMA = exactObject([
	"rowKeys",
	"columns",
	"values"
], {
	rowKeys: arrayOf(RAW_ENTITY_KEY_SCHEMA),
	columns: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	}),
	values: arrayOf(vector())
});
var SHARED_TRAJECTORY_PARTICIPANT_PERIOD_SCHEMA = exactObject([
	"index",
	"participant",
	"participantLabel",
	"group",
	"time",
	"coordinates",
	"fullCoordinates",
	"sourcePointIndexes",
	"includedInCohort"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	participant: RAW_ENTITY_KEY_SCHEMA,
	participantLabel: RAW_ENTITY_KEY_SCHEMA,
	group: RAW_TYPED_VALUE_SCHEMA,
	time: RAW_TYPED_VALUE_SCHEMA,
	coordinates: vector(3),
	fullCoordinates: vector(),
	sourcePointIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	}),
	includedInCohort: { type: "boolean" }
});
var SHARED_TRAJECTORY_CENTROID_SCHEMA = exactObject([
	"index",
	"group",
	"time",
	"coordinates",
	"fullCoordinates",
	"participantCount",
	"participantPeriodIndexes"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	group: RAW_TYPED_VALUE_SCHEMA,
	time: RAW_TYPED_VALUE_SCHEMA,
	coordinates: vector(3),
	fullCoordinates: vector(),
	participantCount: SAFE_POSITIVE_INTEGER_SCHEMA$1,
	participantPeriodIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	})
});
var SHARED_TRAJECTORY_PATH_SCHEMA = exactObject(["group", "steps"], {
	group: RAW_TYPED_VALUE_SCHEMA,
	steps: arrayOf(exactObject(["time", "centroidIndex"], {
		time: RAW_TYPED_VALUE_SCHEMA,
		centroidIndex: nullable(SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1)
	}), { minItems: 1 })
});
var SHARED_TRAJECTORY_SCHEMA = exactObject([
	"space",
	"dimensions",
	"cohortPolicy",
	"groupOrder",
	"timeOrder",
	"participantPeriods",
	"centroids",
	"paths"
], {
	space: { const: "analysis-result-rotation" },
	dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 3,
		uniqueItems: true
	}),
	cohortPolicy: { enum: ["available", "complete"] },
	groupOrder: arrayOf(RAW_TYPED_VALUE_SCHEMA, { minItems: 1 }),
	timeOrder: arrayOf(RAW_TYPED_VALUE_SCHEMA, { minItems: 1 }),
	participantPeriods: arrayOf(SHARED_TRAJECTORY_PARTICIPANT_PERIOD_SCHEMA),
	centroids: arrayOf(SHARED_TRAJECTORY_CENTROID_SCHEMA),
	paths: arrayOf(SHARED_TRAJECTORY_PATH_SCHEMA, { minItems: 1 })
});
var ANALYSIS_PROVENANCE_SCHEMA = exactObject([
	"adapter",
	"adapterVersion",
	"jenaPackage",
	"jenaVersion",
	"jenaCommit",
	"coreGoldenContract",
	"legacyGoldenContract",
	"legacyGoldenStatus",
	"parityContract",
	"resultSemantics",
	"resolvedConfig",
	"resolvedLimits"
], {
	adapter: { const: "@3dena/analysis" },
	adapterVersion: NON_EMPTY_STRING_SCHEMA$1,
	jenaPackage: { const: "jena-js" },
	jenaVersion: NON_EMPTY_STRING_SCHEMA$1,
	jenaCommit: NON_EMPTY_STRING_SCHEMA$1,
	coreGoldenContract: NON_EMPTY_STRING_SCHEMA$1,
	legacyGoldenContract: NON_EMPTY_STRING_SCHEMA$1,
	legacyGoldenStatus: { const: "not-assessed" },
	parityContract: NON_EMPTY_STRING_SCHEMA$1,
	resultSemantics: NON_EMPTY_STRING_SCHEMA$1,
	resolvedConfig: exactObject([
		"model",
		"window",
		"weightBy",
		"windowSizeBack",
		"windowSizeForward",
		"centerAlignToOrigin"
	], {
		model: { enum: [
			"EndPoint",
			"AccumulatedTrajectory",
			"SeparateTrajectory"
		] },
		window: { enum: ["MovingStanzaWindow", "Conversation"] },
		weightBy: { enum: ["binary", "sum"] },
		windowSizeBack: { anyOf: [SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1, { const: "Infinity" }] },
		windowSizeForward: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
		centerAlignToOrigin: { type: "boolean" }
	}),
	resolvedLimits: countObject([
		"maxRows",
		"maxColumns",
		"maxCells",
		"maxAccumulationCells",
		"maxCodes",
		"maxEdges",
		"maxStringLength",
		"maxUnits",
		"maxGroups",
		"maxTimePoints",
		"maxOutputPoints",
		"maxDimensions",
		"maxCoordinateCells"
	], true)
});
var ENA_MODEL_RESULT_SCHEMA_V1 = { ...exactObject([
	"schemaVersion",
	"dimensions",
	"axes",
	"points",
	"nodes",
	"edges",
	"accumulation",
	"variance",
	"rotation",
	"summary",
	"diagnostics",
	"provenance"
], {
	schemaVersion: { const: "3dena.analysis-result.v1" },
	dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 3,
		uniqueItems: true
	}),
	axes: {
		type: "array",
		items: NON_EMPTY_STRING_SCHEMA$1,
		minItems: 3,
		maxItems: 3,
		uniqueItems: true
	},
	points: arrayOf(ANALYSIS_POINT_SCHEMA, { minItems: 1 }),
	nodes: arrayOf(ANALYSIS_NODE_SCHEMA, { minItems: 3 }),
	edges: arrayOf(ANALYSIS_EDGE_SCHEMA, { minItems: 1 }),
	accumulation: exactObject(["modelCounts", "rowCounts"], {
		modelCounts: ACCUMULATION_TABLE_SCHEMA,
		rowCounts: ACCUMULATION_TABLE_SCHEMA
	}),
	variance: arrayOf(exactObject([
		"axis",
		"proportion",
		"eigenvalue",
		"displayed"
	], {
		axis: NON_EMPTY_STRING_SCHEMA$1,
		proportion: FINITE_NUMBER_SCHEMA,
		eigenvalue: FINITE_NUMBER_SCHEMA,
		displayed: { type: "boolean" }
	}), { minItems: 3 }),
	rotation: exactObject([
		"method",
		"columns",
		"matrix",
		"eigenvalues",
		"centerVector"
	], {
		method: { enum: [
			"svd",
			"mean",
			"reference"
		] },
		columns: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
			minItems: 3,
			uniqueItems: true
		}),
		matrix: arrayOf(vector(), { minItems: 1 }),
		eigenvalues: vector(),
		centerVector: vector()
	}),
	trajectory: SHARED_TRAJECTORY_SCHEMA,
	summary: countObject([
		"inputRows",
		"inputColumns",
		"units",
		"points",
		"nodes",
		"edges",
		"modelCountRows",
		"rowCountRows",
		"groups",
		"timePoints",
		"participantPeriods",
		"trajectoryCentroids",
		"dimensions"
	]),
	diagnostics: DIAGNOSTICS_SCHEMA,
	provenance: ANALYSIS_PROVENANCE_SCHEMA
}) };
var NETWORK_MEAN_EDGE_SCHEMA = exactObject([
	"index",
	"id",
	"column",
	"source",
	"target",
	"meanWeight"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	id: NON_EMPTY_STRING_SCHEMA$1,
	column: NON_EMPTY_STRING_SCHEMA$1,
	source: NON_EMPTY_STRING_SCHEMA$1,
	target: NON_EMPTY_STRING_SCHEMA$1,
	meanWeight: FINITE_NUMBER_SCHEMA
});
var NETWORK_MEAN_SCHEMA = exactObject([
	"pointCount",
	"pointIndexes",
	"meanCoordinates",
	"edges"
], {
	pointCount: SAFE_POSITIVE_INTEGER_SCHEMA$1,
	pointIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	}),
	meanCoordinates: vector(),
	edges: arrayOf(NETWORK_MEAN_EDGE_SCHEMA, { minItems: 1 })
});
var NETWORK_COMPARISON_RESULT_SCHEMA = exactObject([
	"schemaVersion",
	"direction",
	"groupA",
	"groupB",
	"meanA",
	"meanB",
	"differenceEdges",
	"diagnostics"
], {
	schemaVersion: { const: "3dena.network-comparison.v1" },
	direction: { const: "group-a-minus-group-b" },
	groupA: RAW_TYPED_VALUE_SCHEMA,
	groupB: RAW_TYPED_VALUE_SCHEMA,
	meanA: NETWORK_MEAN_SCHEMA,
	meanB: NETWORK_MEAN_SCHEMA,
	differenceEdges: arrayOf(exactObject([
		"index",
		"id",
		"column",
		"source",
		"target",
		"meanWeight",
		"groupAMeanWeight",
		"groupBMeanWeight",
		"semanticOwner"
	], {
		index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
		id: NON_EMPTY_STRING_SCHEMA$1,
		column: NON_EMPTY_STRING_SCHEMA$1,
		source: NON_EMPTY_STRING_SCHEMA$1,
		target: NON_EMPTY_STRING_SCHEMA$1,
		meanWeight: FINITE_NUMBER_SCHEMA,
		groupAMeanWeight: FINITE_NUMBER_SCHEMA,
		groupBMeanWeight: FINITE_NUMBER_SCHEMA,
		semanticOwner: { enum: [
			"group-a",
			"group-b",
			"equal"
		] }
	}), { minItems: 1 }),
	diagnostics: DIAGNOSTICS_SCHEMA
});
var CHANGE_NETWORK_RESULT_SCHEMA = exactObject([
	"schemaVersion",
	"selector",
	"levelCanonical",
	"mean",
	"diagnostics"
], {
	schemaVersion: { const: "3dena.change-network.v1" },
	selector: exactObject(["field", "level"], {
		field: NON_EMPTY_STRING_SCHEMA$1,
		level: RAW_SCALAR_SCHEMA$1
	}),
	levelCanonical: NON_EMPTY_STRING_SCHEMA$1,
	mean: NETWORK_MEAN_SCHEMA,
	diagnostics: DIAGNOSTICS_SCHEMA
});
var STATISTICAL_ALTERNATIVE_SCHEMA = { enum: [
	"two-sided",
	"greater",
	"less"
] };
var ADJUSTMENT_METHOD_SCHEMA = { enum: [
	"none",
	"holm",
	"bh",
	"bonferroni"
] };
var STATS_CONTRACT_SCHEMA = constObject({
	schemaVersion: "3dena.stats.contract.v1",
	direction: "A-minus-B",
	missing: "drop-explicit-null",
	ties: "exact-value-midrank",
	signedRankZeros: "drop-exact-zero",
	rankInference: "asymptotic-normal",
	continuityCorrection: true,
	independentCohenD: "pooled-sample-standard-deviation",
	pairedCohenD: "mean-paired-difference-over-sample-sd",
	meanDifferenceConfidenceInterval: "alternative-aligned-t-interval-95-percent",
	pValueAdjustmentFamily: "caller-supplied-complete-family"
});
var CONFIDENCE_BOUND_SCHEMA = { oneOf: [exactObject(["kind", "value"], {
	kind: { const: "finite" },
	value: FINITE_NUMBER_SCHEMA
}), ...[
	"negative-infinity",
	"positive-infinity",
	"undefined",
	"unrepresentable"
].map((kind) => exactObject(["kind"], { kind: { const: kind } }))] };
function confidenceIntervalSchema(method) {
	return exactObject([
		"method",
		"confidenceLevel",
		"alternative",
		"lower",
		"upper"
	], {
		method: { const: method },
		confidenceLevel: { const: .95 },
		alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
		lower: CONFIDENCE_BOUND_SCHEMA,
		upper: CONFIDENCE_BOUND_SCHEMA
	});
}
var ADJUSTMENT_SCHEMA = exactObject([
	"method",
	"raw",
	"adjusted"
], {
	method: ADJUSTMENT_METHOD_SCHEMA,
	raw: arrayOf(PROBABILITY_SCHEMA, { minItems: 1 }),
	adjusted: arrayOf(PROBABILITY_SCHEMA, { minItems: 1 })
});
var EFFECTS_SCHEMA = exactObject(["cohensD", "rankBiserial"], {
	cohensD: nullable(FINITE_NUMBER_SCHEMA),
	rankBiserial: FINITE_NUMBER_SCHEMA
});
var INDEPENDENT_STATS_RESULT_SCHEMA = exactObject([
	"schemaVersion",
	"design",
	"direction",
	"contract",
	"alternative",
	"samples",
	"estimates",
	"welch",
	"mannWhitney",
	"effects",
	"adjustment",
	"diagnostics"
], {
	schemaVersion: { const: "3dena.stats.independent-result.v1" },
	design: { const: "independent" },
	direction: { const: "A-minus-B" },
	contract: STATS_CONTRACT_SCHEMA,
	alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
	samples: exactObject(["sideA", "sideB"], Object.fromEntries(["sideA", "sideB"].map((side) => [side, exactObject([
		"label",
		"input",
		"valid",
		"droppedMissing"
	], {
		label: NON_EMPTY_STRING_SCHEMA$1,
		input: SAFE_POSITIVE_INTEGER_SCHEMA$1,
		valid: SAFE_POSITIVE_INTEGER_SCHEMA$1,
		droppedMissing: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1
	})]))),
	estimates: exactObject([
		"meanA",
		"meanB",
		"meanDifference",
		"confidenceInterval"
	], {
		meanA: FINITE_NUMBER_SCHEMA,
		meanB: FINITE_NUMBER_SCHEMA,
		meanDifference: nullable(FINITE_NUMBER_SCHEMA),
		confidenceInterval: confidenceIntervalSchema("welch-t-mean-difference-v1")
	}),
	welch: exactObject([
		"method",
		"alternative",
		"statistic",
		"degreesOfFreedom",
		"pValue"
	], {
		method: { const: "welch-t-v1" },
		alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
		statistic: nullable(FINITE_NUMBER_SCHEMA),
		degreesOfFreedom: nullable(FINITE_NUMBER_SCHEMA),
		pValue: PROBABILITY_SCHEMA
	}),
	mannWhitney: exactObject([
		"method",
		"alternative",
		"tiePolicy",
		"continuityCorrection",
		"uA",
		"uB",
		"z",
		"pValue",
		"tieGroups",
		"tiedObservations"
	], {
		method: { const: "mann-whitney-asymptotic-v1" },
		alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
		tiePolicy: { const: "exact-value-midrank" },
		continuityCorrection: { const: true },
		uA: FINITE_NUMBER_SCHEMA,
		uB: FINITE_NUMBER_SCHEMA,
		z: FINITE_NUMBER_SCHEMA,
		pValue: PROBABILITY_SCHEMA,
		tieGroups: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
		tiedObservations: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1
	}),
	effects: EFFECTS_SCHEMA,
	adjustment: ADJUSTMENT_SCHEMA,
	diagnostics: DIAGNOSTICS_SCHEMA
});
var PAIRED_STATS_RESULT_SCHEMA = exactObject([
	"schemaVersion",
	"design",
	"direction",
	"contract",
	"alternative",
	"matching",
	"estimates",
	"wilcoxonSignedRank",
	"effects",
	"adjustment",
	"diagnostics"
], {
	schemaVersion: { const: "3dena.stats.paired-result.v1" },
	design: { const: "paired" },
	direction: { const: "A-minus-B" },
	contract: STATS_CONTRACT_SCHEMA,
	alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
	matching: countObject([
		"sideAInput",
		"sideBInput",
		"matched",
		"validPairs",
		"droppedMissingPairs",
		"unmatchedA",
		"unmatchedB",
		"zeroDifferences",
		"rankedPairs"
	]),
	estimates: exactObject(["meanDifference", "confidenceInterval"], {
		meanDifference: nullable(FINITE_NUMBER_SCHEMA),
		confidenceInterval: confidenceIntervalSchema("paired-t-mean-difference-v1")
	}),
	wilcoxonSignedRank: exactObject([
		"method",
		"alternative",
		"tiePolicy",
		"zeroPolicy",
		"continuityCorrection",
		"statistic",
		"wPositive",
		"wNegative",
		"z",
		"pValue",
		"tieGroups",
		"tiedObservations"
	], {
		method: { const: "wilcoxon-signed-rank-asymptotic-v1" },
		alternative: STATISTICAL_ALTERNATIVE_SCHEMA,
		tiePolicy: { const: "exact-absolute-difference-midrank" },
		zeroPolicy: { const: "drop-exact-zero" },
		continuityCorrection: { const: true },
		statistic: FINITE_NUMBER_SCHEMA,
		wPositive: FINITE_NUMBER_SCHEMA,
		wNegative: FINITE_NUMBER_SCHEMA,
		z: FINITE_NUMBER_SCHEMA,
		pValue: PROBABILITY_SCHEMA,
		tieGroups: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
		tiedObservations: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1
	}),
	effects: EFFECTS_SCHEMA,
	adjustment: ADJUSTMENT_SCHEMA,
	diagnostics: DIAGNOSTICS_SCHEMA
});
var STATISTICS_TASK_RESULT_SCHEMA = exactObject([
	"schemaVersion",
	"design",
	"direction",
	"groups",
	"dimensions"
], {
	schemaVersion: { const: "3dena.statistics-task-result.v1" },
	design: { enum: ["independent", "paired"] },
	direction: { const: "group-a-minus-group-b" },
	groups: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 2,
		maxItems: 2,
		uniqueItems: true
	}),
	dimensions: arrayOf(exactObject(["dimension", "result"], {
		dimension: NON_EMPTY_STRING_SCHEMA$1,
		result: { oneOf: [INDEPENDENT_STATS_RESULT_SCHEMA, PAIRED_STATS_RESULT_SCHEMA] }
	}), { minItems: 1 })
});
STATISTICS_TASK_RESULT_SCHEMA.allOf = [{
	if: { properties: { design: { const: "independent" } } },
	then: { properties: { dimensions: { items: { properties: { result: INDEPENDENT_STATS_RESULT_SCHEMA } } } } }
}, {
	if: { properties: { design: { const: "paired" } } },
	then: { properties: { dimensions: { items: { properties: { result: PAIRED_STATS_RESULT_SCHEMA } } } } }
}];
var TRAJECTORY_KEY_SCHEMA = exactObject([
	"components",
	"canonical",
	"display"
], {
	components: arrayOf({ oneOf: [
		exactObject([
			"name",
			"type",
			"value"
		], {
			name: NON_EMPTY_STRING_SCHEMA$1,
			type: { const: "string" },
			value: NON_EMPTY_STRING_SCHEMA$1,
			declaredType: NON_EMPTY_STRING_SCHEMA$1
		}),
		exactObject([
			"name",
			"type",
			"value"
		], {
			name: NON_EMPTY_STRING_SCHEMA$1,
			type: { const: "number" },
			value: FINITE_NUMBER_SCHEMA,
			declaredType: NON_EMPTY_STRING_SCHEMA$1
		}),
		exactObject([
			"name",
			"type",
			"value"
		], {
			name: NON_EMPTY_STRING_SCHEMA$1,
			type: { const: "boolean" },
			value: { type: "boolean" },
			declaredType: NON_EMPTY_STRING_SCHEMA$1
		})
	] }, { minItems: 1 }),
	canonical: NON_EMPTY_STRING_SCHEMA$1,
	display: NON_EMPTY_STRING_SCHEMA$1
});
var TRAJECTORY_TIME_VALUE_SCHEMA = { oneOf: [
	exactObject([
		"type",
		"value",
		"unit"
	], {
		type: { const: "numeric-v1" },
		value: FINITE_NUMBER_SCHEMA,
		unit: NON_EMPTY_STRING_SCHEMA$1
	}),
	exactObject(["type", "value"], {
		type: { const: "date-v1" },
		value: {
			type: "string",
			pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
		}
	}),
	exactObject([
		"type",
		"epochMilliseconds",
		"timeZone",
		"offsetMinutes",
		"fold",
		"elapsedUnit"
	], {
		type: { const: "instant-v1" },
		epochMilliseconds: {
			type: "string",
			pattern: "^-?(?:0|[1-9][0-9]*)$"
		},
		timeZone: NON_EMPTY_STRING_SCHEMA$1,
		offsetMinutes: {
			type: "integer",
			minimum: -1440,
			maximum: 1440
		},
		fold: { enum: [0, 1] },
		elapsedUnit: { enum: DURATION_UNITS$1 }
	}),
	exactObject([
		"type",
		"value",
		"unit",
		"elapsedUnit"
	], {
		type: { const: "difftime-v1" },
		value: FINITE_NUMBER_SCHEMA,
		unit: { enum: DURATION_UNITS$1 },
		elapsedUnit: { enum: DURATION_UNITS$1 }
	})
] };
function distanceMetricsSchema(includeSpeed) {
	return exactObject([
		"dimensions",
		"delta",
		"stepDistance",
		"cumulativeDistance",
		...includeSpeed ? ["speed"] : []
	], {
		dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
			minItems: 1,
			uniqueItems: true
		}),
		delta: nullable(vector()),
		stepDistance: nullable(FINITE_NUMBER_SCHEMA),
		cumulativeDistance: nullable(FINITE_NUMBER_SCHEMA),
		...includeSpeed ? { speed: nullable(FINITE_NUMBER_SCHEMA) } : {}
	});
}
function trajectoryParticipantPeriodSchema(weighted) {
	return exactObject([
		"index",
		"participant",
		"time",
		"selectedCoordinates",
		"fullCoordinates",
		"sourceRowIndexes",
		...weighted ? ["participantWeight"] : [],
		"includedInCohort"
	], {
		index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
		participant: TRAJECTORY_KEY_SCHEMA,
		time: TRAJECTORY_KEY_SCHEMA,
		selectedCoordinates: vector(3),
		fullCoordinates: vector(),
		sourceRowIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1, {
			minItems: 1,
			uniqueItems: true
		}),
		...weighted ? { participantWeight: {
			type: "number",
			exclusiveMinimum: 0
		} } : {},
		includedInCohort: { type: "boolean" }
	});
}
var TRAJECTORY_PATH_PERIOD_SCHEMA = exactObject([
	"index",
	"time",
	"selectedCentroid",
	"fullCentroid",
	"selected3d",
	"fullSpace",
	"nRows",
	"nTotal",
	"nUsed",
	"nDuplicateRows",
	"nCohortExcluded"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	time: TRAJECTORY_KEY_SCHEMA,
	selectedCentroid: nullable(vector(3)),
	fullCentroid: nullable(vector()),
	selected3d: distanceMetricsSchema(false),
	fullSpace: distanceMetricsSchema(false),
	nRows: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	nTotal: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	nUsed: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	nDuplicateRows: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	nCohortExcluded: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1
});
var TRAJECTORY_PATH_STATISTICS_SCHEMA = exactObject([
	"schemaVersion",
	"namespace",
	"cohortPolicy",
	"estimand",
	"dimensions",
	"selectedDimensions",
	"distanceSemantics",
	"participantPeriods",
	"periods",
	"diagnostics",
	"summary",
	"resolvedLimits"
], {
	schemaVersion: { const: "3dena.trajectory-path-statistics.v1" },
	namespace: NON_EMPTY_STRING_SCHEMA$1,
	cohortPolicy: { enum: ["available", "complete"] },
	estimand: { enum: ["equal-participant", "weighted-participant"] },
	dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	}),
	selectedDimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 3,
		maxItems: 3,
		uniqueItems: true
	}),
	distanceSemantics: constObject({
		selected3d: "euclidean-selected-three-dimensions",
		fullSpace: "euclidean-all-declared-dimensions"
	}),
	participantPeriods: arrayOf(trajectoryParticipantPeriodSchema(true)),
	periods: arrayOf(TRAJECTORY_PATH_PERIOD_SCHEMA),
	diagnostics: DIAGNOSTICS_SCHEMA,
	summary: countObject([
		"inputRows",
		"participants",
		"participantPeriods",
		"periods",
		"duplicateRows"
	]),
	resolvedLimits: countObject([
		"maxPoints",
		"maxDimensions",
		"maxPeriods",
		"maxParticipants",
		"maxCells",
		"maxResamples",
		"maxTests"
	], true)
});
var TRAJECTORY_TIME_CONTRACT_SCHEMA = { oneOf: [
	exactObject([
		"kind",
		"elapsedUnit",
		"chronology"
	], {
		kind: { const: "numeric-v1" },
		elapsedUnit: NON_EMPTY_STRING_SCHEMA$1,
		chronology: { const: "strictly-increasing-finite-number-v1" }
	}),
	constObject({
		kind: "date-v1",
		elapsedUnit: "days",
		calendar: "proleptic-gregorian-v1",
		chronology: "strictly-increasing-civil-day-v1"
	}),
	exactObject([
		"kind",
		"elapsedUnit",
		"epoch",
		"chronology",
		"zoneRole"
	], {
		kind: { const: "instant-v1" },
		elapsedUnit: { enum: DURATION_UNITS$1 },
		epoch: { const: "unix-epoch-milliseconds-int64-v1" },
		chronology: { const: "strictly-increasing-exact-epoch-v1" },
		zoneRole: { const: "presentation-provenance-only" }
	}),
	exactObject([
		"kind",
		"elapsedUnit",
		"conversion",
		"chronology"
	], {
		kind: { const: "difftime-v1" },
		elapsedUnit: { enum: DURATION_UNITS$1 },
		conversion: { const: "fixed-duration-unit-ratios-v1" },
		chronology: { const: "strictly-increasing-normalized-duration-v1" }
	})
] };
var TRAJECTORY_DYNAMICS_PERIOD_SCHEMA = exactObject([
	"index",
	"time",
	"timeValue",
	"elapsedFromPrevious",
	"elapsedFromStart",
	"selectedCentroid",
	"fullCentroid",
	"selected3d",
	"fullSpace",
	"nRows",
	"nParticipantPeriods",
	"nUsed",
	"nDuplicateRows",
	"nCohortExcluded",
	"weightSum",
	"effectiveParticipantN"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	time: TRAJECTORY_KEY_SCHEMA,
	timeValue: TRAJECTORY_TIME_VALUE_SCHEMA,
	elapsedFromPrevious: nullable(FINITE_NUMBER_SCHEMA),
	elapsedFromStart: FINITE_NUMBER_SCHEMA,
	selectedCentroid: nullable(vector(3)),
	fullCentroid: nullable(vector()),
	selected3d: distanceMetricsSchema(true),
	fullSpace: distanceMetricsSchema(true),
	nRows: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	nParticipantPeriods: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	nUsed: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	nDuplicateRows: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	nCohortExcluded: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	weightSum: nullable(FINITE_NUMBER_SCHEMA),
	effectiveParticipantN: nullable(FINITE_NUMBER_SCHEMA)
});
var TRAJECTORY_DYNAMICS_RESULT_SCHEMA = exactObject([
	"schemaVersion",
	"namespace",
	"cohortPolicy",
	"estimand",
	"dimensions",
	"selectedDimensions",
	"timeContract",
	"contracts",
	"participantPeriods",
	"periods",
	"diagnostics",
	"diagnosticSummary",
	"summary",
	"evidence",
	"resolvedLimits"
], {
	schemaVersion: { const: "3dena.trajectory-dynamics.v1" },
	namespace: NON_EMPTY_STRING_SCHEMA$1,
	cohortPolicy: { enum: ["available", "complete"] },
	estimand: exactObject(["kind"], { kind: { enum: ["equal-participant-v1", "weighted-participant-v1"] } }),
	dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	}),
	selectedDimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 3,
		maxItems: 3,
		uniqueItems: true
	}),
	timeContract: TRAJECTORY_TIME_CONTRACT_SCHEMA,
	contracts: constObject({
		duplicateReduction: "equal-row-coordinate-mean-before-centroid-v1",
		weightResolution: "constant-within-participant-period-v1",
		cohort: "available-or-complete-before-centroid-v1",
		distance: "euclidean-selected-and-full-space-v1",
		gap: "expected-period-no-bridge-v1",
		speed: "step-distance-divided-by-positive-adjacent-elapsed-v1"
	}),
	participantPeriods: arrayOf(trajectoryParticipantPeriodSchema(true)),
	periods: arrayOf(TRAJECTORY_DYNAMICS_PERIOD_SCHEMA),
	diagnostics: DIAGNOSTICS_SCHEMA,
	diagnosticSummary: exactObject([
		"info",
		"warning",
		"codes"
	], {
		info: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
		warning: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
		codes: arrayOf(NON_EMPTY_STRING_SCHEMA$1, { uniqueItems: true })
	}),
	summary: countObject([
		"inputRows",
		"participants",
		"participantPeriods",
		"periods",
		"observedPeriods",
		"missingPeriods",
		"duplicateRows",
		"cohortExcludedParticipants"
	]),
	evidence: constObject({
		status: "IMPLEMENTED_UNVERIFIED",
		oracleParityClaim: false,
		scientificAuthority: "successor-definition-pending-review"
	}),
	resolvedLimits: countObject([
		"maxPoints",
		"maxDimensions",
		"maxPeriods",
		"maxParticipants",
		"maxCells"
	], true)
});
var TRAJECTORY_COMPARISON_PERIOD_SCHEMA = exactObject([
	"index",
	"time",
	"selectedCentroidA",
	"selectedCentroidB",
	"selectedDifference",
	"fullCentroidA",
	"fullCentroidB",
	"fullDifference",
	"selectedCentroidSeparation",
	"fullCentroidSeparation",
	"selectedStepDistanceA",
	"selectedStepDistanceB",
	"selectedStepDistanceDifference",
	"selectedCumulativeDistanceA",
	"selectedCumulativeDistanceB",
	"selectedCumulativeDistanceDifference",
	"fullStepDistanceA",
	"fullStepDistanceB",
	"fullStepDistanceDifference",
	"fullCumulativeDistanceA",
	"fullCumulativeDistanceB",
	"fullCumulativeDistanceDifference",
	"nAUsed",
	"nBUsed",
	"nMatched"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	time: TRAJECTORY_KEY_SCHEMA,
	selectedCentroidA: nullable(vector(3)),
	selectedCentroidB: nullable(vector(3)),
	selectedDifference: nullable(vector(3)),
	fullCentroidA: nullable(vector()),
	fullCentroidB: nullable(vector()),
	fullDifference: nullable(vector()),
	...Object.fromEntries([
		"selectedCentroidSeparation",
		"fullCentroidSeparation",
		"selectedStepDistanceA",
		"selectedStepDistanceB",
		"selectedStepDistanceDifference",
		"selectedCumulativeDistanceA",
		"selectedCumulativeDistanceB",
		"selectedCumulativeDistanceDifference",
		"fullStepDistanceA",
		"fullStepDistanceB",
		"fullStepDistanceDifference",
		"fullCumulativeDistanceA",
		"fullCumulativeDistanceB",
		"fullCumulativeDistanceDifference"
	].map((field) => [field, nullable(FINITE_NUMBER_SCHEMA)])),
	nAUsed: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	nBUsed: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	nMatched: nullable(SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1)
});
var TRAJECTORY_COMPARISON_RESULT_SCHEMA = exactObject([
	"schemaVersion",
	"design",
	"direction",
	"pairedId",
	"sideA",
	"sideB",
	"periods",
	"tests",
	"permutation",
	"diagnostics"
], {
	schemaVersion: { const: "3dena.trajectory-comparison.v1" },
	design: { enum: ["paired", "independent"] },
	direction: { const: "B-minus-A" },
	pairedId: { oneOf: [
		{ type: "null" },
		NON_EMPTY_STRING_SCHEMA$1,
		arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
			minItems: 1,
			uniqueItems: true
		})
	] },
	sideA: TRAJECTORY_PATH_STATISTICS_SCHEMA,
	sideB: TRAJECTORY_PATH_STATISTICS_SCHEMA,
	periods: arrayOf(TRAJECTORY_COMPARISON_PERIOD_SCHEMA),
	tests: arrayOf(exactObject([
		"id",
		"timeIndex",
		"metric",
		"distanceSpace",
		"tail",
		"observed",
		"pValue",
		"holmAdjustedPValue",
		"permutationCount"
	], {
		id: NON_EMPTY_STRING_SCHEMA$1,
		timeIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
		metric: NON_EMPTY_STRING_SCHEMA$1,
		distanceSpace: { enum: [
			null,
			"selected-3d",
			"full-space"
		] },
		tail: { enum: ["two-sided", "upper"] },
		observed: FINITE_NUMBER_SCHEMA,
		pValue: PROBABILITY_SCHEMA,
		holmAdjustedPValue: PROBABILITY_SCHEMA,
		permutationCount: SAFE_POSITIVE_INTEGER_SCHEMA$1
	})),
	permutation: exactObject([
		"status",
		"planKind",
		"unitOrder",
		"replicateCount",
		"rngParityClaim"
	], {
		status: { enum: ["not-requested", "complete"] },
		planKind: { enum: [
			null,
			"paired-swap-indices-v1",
			"independent-pool-indices-v1"
		] },
		unitOrder: arrayOf(NON_EMPTY_STRING_SCHEMA$1, { uniqueItems: true }),
		replicateCount: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
		rngParityClaim: { const: false }
	}),
	diagnostics: DIAGNOSTICS_SCHEMA
});
TRAJECTORY_COMPARISON_RESULT_SCHEMA.allOf = [{
	if: { properties: { design: { const: "independent" } } },
	then: { properties: { pairedId: { type: "null" } } }
}, {
	if: { properties: { design: { const: "paired" } } },
	then: { properties: { pairedId: { oneOf: [NON_EMPTY_STRING_SCHEMA$1, arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	})] } } }
}];
var BOOTSTRAP_INTERVAL_SCHEMA = exactObject([
	"estimate",
	"lower",
	"upper",
	"finiteReplicates",
	"requiredFiniteReplicates",
	"totalReplicates"
], {
	estimate: FINITE_NUMBER_SCHEMA,
	lower: FINITE_NUMBER_SCHEMA,
	upper: FINITE_NUMBER_SCHEMA,
	finiteReplicates: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	requiredFiniteReplicates: SAFE_POSITIVE_INTEGER_SCHEMA$1,
	totalReplicates: SAFE_POSITIVE_INTEGER_SCHEMA$1
});
var BOOTSTRAP_PERIOD_SCHEMA = exactObject([
	"index",
	"time",
	"selectedCentroid",
	"fullCentroid",
	"selectedStepDistance",
	"fullStepDistance",
	"selectedCumulativeDistance",
	"fullCumulativeDistance"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	time: TRAJECTORY_KEY_SCHEMA,
	selectedCentroid: arrayOf(nullable(BOOTSTRAP_INTERVAL_SCHEMA), {
		minItems: 3,
		maxItems: 3
	}),
	fullCentroid: arrayOf(nullable(BOOTSTRAP_INTERVAL_SCHEMA), { minItems: 1 }),
	selectedStepDistance: nullable(BOOTSTRAP_INTERVAL_SCHEMA),
	fullStepDistance: nullable(BOOTSTRAP_INTERVAL_SCHEMA),
	selectedCumulativeDistance: nullable(BOOTSTRAP_INTERVAL_SCHEMA),
	fullCumulativeDistance: nullable(BOOTSTRAP_INTERVAL_SCHEMA)
});
var BOOTSTRAP_GENERATION_SCHEMA = { oneOf: [exactObject(["kind"], { kind: { const: "caller-provided" } }), exactObject([
	"kind",
	"algorithm",
	"seed",
	"unitSort",
	"randomEndpoint"
], {
	kind: { const: "seeded" },
	algorithm: { const: "mulberry32-uint32-v1" },
	seed: UINT32_SCHEMA,
	unitSort: { const: "utf16-code-unit-ascending" },
	randomEndpoint: { const: "zero-inclusive-one-exclusive" }
})] };
var BOOTSTRAP_RESULT_SCHEMA = exactObject([
	"schemaVersion",
	"base",
	"confidenceLevel",
	"periods",
	"quantileRule",
	"resampling",
	"diagnostics"
], {
	schemaVersion: { const: "3dena.trajectory-bootstrap.v1" },
	base: TRAJECTORY_PATH_STATISTICS_SCHEMA,
	confidenceLevel: {
		type: "number",
		exclusiveMinimum: 0,
		exclusiveMaximum: 1
	},
	periods: arrayOf(BOOTSTRAP_PERIOD_SCHEMA),
	quantileRule: constObject({
		id: "linear-type7-v1",
		sort: "ascending-numeric",
		position: "(n-1)*p",
		interpolation: "linear-between-floor-and-ceiling",
		endpoints: "p=0-min-p=1-max"
	}),
	resampling: exactObject([
		"unit",
		"stratified",
		"strata",
		"replicateCount",
		"planKind",
		"generation",
		"rngParityClaim"
	], {
		unit: { const: "participant-complete-history" },
		stratified: { type: "boolean" },
		strata: arrayOf(exactObject(["key", "unitCount"], {
			key: TRAJECTORY_KEY_SCHEMA,
			unitCount: SAFE_POSITIVE_INTEGER_SCHEMA$1
		}), { minItems: 1 }),
		replicateCount: SAFE_POSITIVE_INTEGER_SCHEMA$1,
		planKind: { enum: ["participant-history-resample-indices-v1", "global-participant-history-resample-indices-v2"] },
		generation: BOOTSTRAP_GENERATION_SCHEMA,
		rngParityClaim: { const: false }
	}),
	diagnostics: DIAGNOSTICS_SCHEMA
});
var PREPARED_ENTITY_KEY_SCHEMA = exactObject([
	"canonical",
	"display",
	"columns",
	"columnTypes",
	"values"
], {
	canonical: NON_EMPTY_STRING_SCHEMA$1,
	display: { type: "string" },
	columns: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	}),
	columnTypes: arrayOf({ enum: PREPARED_COLUMN_TYPES }, { minItems: 1 }),
	values: arrayOf(RAW_SCALAR_SCHEMA$1, { minItems: 1 })
});
var PREPARED_TYPED_VALUE_SCHEMA = exactObject([
	"canonical",
	"display",
	"column",
	"columnType",
	"value"
], {
	canonical: NON_EMPTY_STRING_SCHEMA$1,
	display: { type: "string" },
	column: NON_EMPTY_STRING_SCHEMA$1,
	columnType: { enum: PREPARED_COLUMN_TYPES },
	value: RAW_SCALAR_SCHEMA$1
});
var PREPARED_MAPPING_SCHEMA = exactObject([
	"participant",
	"participantLabel",
	"group",
	"time",
	"timeOrder",
	"cohortPolicy",
	"displayDimensions",
	"missingDisplayCoordinates"
], {
	participant: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	}),
	participantLabel: NON_EMPTY_STRING_SCHEMA$1,
	group: NON_EMPTY_STRING_SCHEMA$1,
	time: NON_EMPTY_STRING_SCHEMA$1,
	timeOrder: arrayOf(RAW_SCALAR_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	}),
	cohortPolicy: { enum: ["available", "complete"] },
	displayDimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 3,
		maxItems: 3,
		uniqueItems: true
	}),
	missingDisplayCoordinates: { const: "reject" }
});
var PREPARED_POINT_SCHEMA = exactObject([
	"index",
	"id",
	"participant",
	"participantLabel",
	"group",
	"time",
	"metadata",
	"coordinates"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	id: PREPARED_ENTITY_KEY_SCHEMA,
	participant: PREPARED_ENTITY_KEY_SCHEMA,
	participantLabel: PREPARED_TYPED_VALUE_SCHEMA,
	group: PREPARED_TYPED_VALUE_SCHEMA,
	time: PREPARED_TYPED_VALUE_SCHEMA,
	metadata: {
		type: "object",
		additionalProperties: RAW_SCALAR_SCHEMA$1
	},
	coordinates: vector()
});
var PREPARED_NODE_SCHEMA = exactObject([
	"index",
	"code",
	"coordinates"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	code: NON_EMPTY_STRING_SCHEMA$1,
	coordinates: vector()
});
var PREPARED_EDGE_SCHEMA = ANALYSIS_EDGE_SCHEMA;
var PREPARED_DISPLAY_PARTICIPANT_PERIOD_SCHEMA = exactObject([
	"index",
	"participant",
	"participantLabel",
	"group",
	"time",
	"coordinates",
	"sourcePointIndexes",
	"includedInCohort"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	participant: PREPARED_ENTITY_KEY_SCHEMA,
	participantLabel: PREPARED_TYPED_VALUE_SCHEMA,
	group: PREPARED_TYPED_VALUE_SCHEMA,
	time: PREPARED_TYPED_VALUE_SCHEMA,
	coordinates: vector(3),
	sourcePointIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	}),
	includedInCohort: { type: "boolean" }
});
var PREPARED_DISPLAY_CENTROID_SCHEMA = exactObject([
	"index",
	"group",
	"time",
	"coordinates",
	"participantCount",
	"participantPeriodIndexes"
], {
	index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
	group: PREPARED_TYPED_VALUE_SCHEMA,
	time: PREPARED_TYPED_VALUE_SCHEMA,
	coordinates: vector(3),
	participantCount: SAFE_POSITIVE_INTEGER_SCHEMA$1,
	participantPeriodIndexes: arrayOf(SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1, {
		minItems: 1,
		uniqueItems: true
	})
});
var PREPARED_DISPLAY_PATH_SCHEMA = exactObject(["group", "steps"], {
	group: PREPARED_TYPED_VALUE_SCHEMA,
	steps: arrayOf(exactObject(["time", "centroidIndex"], {
		time: PREPARED_TYPED_VALUE_SCHEMA,
		centroidIndex: nullable(SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1)
	}), { minItems: 1 })
});
var PREPARED_TRAJECTORY_SCHEMA = exactObject([
	"space",
	"dimensions",
	"cohortPolicy",
	"groupOrder",
	"timeOrder",
	"participantPeriods",
	"centroids",
	"paths"
], {
	space: { const: "prepared-exchange-display-space" },
	dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
		minItems: 3,
		maxItems: 3,
		uniqueItems: true
	}),
	cohortPolicy: { enum: ["available", "complete"] },
	groupOrder: arrayOf(PREPARED_TYPED_VALUE_SCHEMA, { minItems: 1 }),
	timeOrder: arrayOf(PREPARED_TYPED_VALUE_SCHEMA, { minItems: 1 }),
	participantPeriods: arrayOf(PREPARED_DISPLAY_PARTICIPANT_PERIOD_SCHEMA),
	centroids: arrayOf(PREPARED_DISPLAY_CENTROID_SCHEMA),
	paths: arrayOf(PREPARED_DISPLAY_PATH_SCHEMA, { minItems: 1 })
});
var PREPARED_SPACE_RESULT_SCHEMA_V1 = exactObject([
	"schemaVersion",
	"sourceKind",
	"rawJenaRecompute",
	"sourceReceipt",
	"artifacts",
	"fullSpace",
	"displaySpace",
	"summary",
	"diagnostics",
	"provenance"
], {
	schemaVersion: { const: "3dena.prepared-space-result.v1" },
	sourceKind: { const: "prepared-exchange" },
	rawJenaRecompute: { const: false },
	sourceReceipt: exactObject([
		"name",
		"sha256",
		"byteLength"
	], {
		name: NON_EMPTY_STRING_SCHEMA$1,
		sha256: HASH_SCHEMA$1,
		byteLength: SAFE_POSITIVE_INTEGER_SCHEMA$1
	}),
	artifacts: constObject({
		rotation: "not-present",
		eigenvalues: "not-present",
		variance: "not-present"
	}),
	fullSpace: exactObject([
		"dimensions",
		"points",
		"nodes",
		"edges",
		"lineWeights"
	], {
		dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
			minItems: 1,
			uniqueItems: true
		}),
		points: arrayOf(PREPARED_POINT_SCHEMA, { minItems: 1 }),
		nodes: arrayOf(PREPARED_NODE_SCHEMA, { minItems: 1 }),
		edges: arrayOf(PREPARED_EDGE_SCHEMA, { minItems: 1 }),
		lineWeights: exactObject([
			"rowKeys",
			"columns",
			"values"
		], {
			rowKeys: arrayOf(PREPARED_ENTITY_KEY_SCHEMA, { minItems: 1 }),
			columns: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
				minItems: 1,
				uniqueItems: true
			}),
			values: arrayOf(vector(), { minItems: 1 })
		})
	}),
	displaySpace: exactObject([
		"dimensions",
		"points",
		"nodes",
		"trajectory"
	], {
		dimensions: arrayOf(NON_EMPTY_STRING_SCHEMA$1, {
			minItems: 3,
			maxItems: 3,
			uniqueItems: true
		}),
		points: arrayOf(exactObject([
			"pointIndex",
			"id",
			"group",
			"time",
			"coordinates"
		], {
			pointIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
			id: PREPARED_ENTITY_KEY_SCHEMA,
			group: PREPARED_TYPED_VALUE_SCHEMA,
			time: PREPARED_TYPED_VALUE_SCHEMA,
			coordinates: vector(3)
		}), { minItems: 1 }),
		nodes: arrayOf(exactObject([
			"nodeIndex",
			"code",
			"coordinates"
		], {
			nodeIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA$1,
			code: NON_EMPTY_STRING_SCHEMA$1,
			coordinates: vector(3)
		}), { minItems: 1 }),
		trajectory: PREPARED_TRAJECTORY_SCHEMA
	}),
	summary: countObject([
		"dimensions",
		"points",
		"nodes",
		"edges",
		"lineWeightRows",
		"groups",
		"timePoints",
		"participantPeriods",
		"trajectoryCentroids"
	]),
	diagnostics: DIAGNOSTICS_SCHEMA,
	provenance: exactObject([
		"adapter",
		"adapterVersion",
		"coordinateSpace",
		"computation",
		"jenaExecuted",
		"resolvedMapping"
	], {
		adapter: { const: "@3dena/analysis" },
		adapterVersion: { const: "0.1.0" },
		coordinateSpace: { const: "precomputed-import" },
		computation: { const: "reduction-only" },
		jenaExecuted: { const: false },
		resolvedMapping: PREPARED_MAPPING_SCHEMA
	})
});
var RESULT_VARIANT_SCHEMAS_V1 = Object.freeze({
	"ena-model": ENA_MODEL_RESULT_SCHEMA_V1,
	"prepared-import": PREPARED_SPACE_RESULT_SCHEMA_V1,
	"network-comparison": NETWORK_COMPARISON_RESULT_SCHEMA,
	"change-network": CHANGE_NETWORK_RESULT_SCHEMA,
	statistics: STATISTICS_TASK_RESULT_SCHEMA,
	trajectory: TRAJECTORY_DYNAMICS_RESULT_SCHEMA,
	"trajectory-comparison": TRAJECTORY_COMPARISON_RESULT_SCHEMA,
	bootstrap: BOOTSTRAP_RESULT_SCHEMA
});
var ANALYSIS_EXECUTION_DATASET_V2_SCHEMA = {
	$id: "https://3dena.com/schemas/analysis-execution-dataset.v2.json",
	...exactObject([
		"schemaVersion",
		"receipt",
		"specHash",
		"buildId"
	], {
		schemaVersion: { const: "3dena.analysis-execution-dataset.v2" },
		receipt: { $ref: "https://3dena.com/schemas/dataset-receipt.v1.json" },
		specHash: HASH_SCHEMA$1,
		buildId: NON_EMPTY_STRING_SCHEMA$1,
		generatedAt: {
			type: "string",
			minLength: 1,
			format: "date-time"
		},
		sourceResult: { oneOf: [exactObject([
			"sourceKind",
			"hash",
			"result"
		], {
			sourceKind: { const: "raw-jena" },
			hash: HASH_SCHEMA$1,
			result: ENA_MODEL_RESULT_SCHEMA_V1
		}), exactObject([
			"sourceKind",
			"hash",
			"result"
		], {
			sourceKind: { const: "prepared-exchange" },
			hash: HASH_SCHEMA$1,
			result: PREPARED_SPACE_RESULT_SCHEMA_V1
		})] }
	}),
	allOf: [{
		if: {
			required: ["sourceResult"],
			properties: { sourceResult: {
				required: ["sourceKind"],
				properties: { sourceKind: { const: "prepared-exchange" } }
			} }
		},
		then: { properties: { receipt: { properties: { format: { const: "ena3d-json" } } } } }
	}]
};
//#endregion
//#region packages/analysis/src/contracts.ts
var ANALYSIS_CONTRACT_VERSION_V1 = "3dena.contract.v1";
var DATASET_RECEIPT_VERSION_V1 = "3dena.dataset-receipt.v1";
var ANALYSIS_TASK_VERSION_V1 = "3dena.analysis-task.v1";
var RESULT_ENVELOPE_VERSION_V1 = "3dena.analysis-result-envelope.v1";
var PROVENANCE_MANIFEST_VERSION_V1 = "3dena.provenance-manifest.v1";
var RESULT_SCHEMA_VERSION_BY_TASK_KIND_V1 = Object.freeze({
	"ena-model": "3dena.analysis-result.v1",
	"prepared-import": "3dena.prepared-space-result.v1",
	"network-comparison": "3dena.network-comparison.v1",
	"change-network": "3dena.change-network.v1",
	statistics: "3dena.statistics-task-result.v1",
	trajectory: "3dena.trajectory-dynamics.v1",
	"trajectory-comparison": "3dena.trajectory-comparison.v1",
	bootstrap: "3dena.trajectory-bootstrap.v1"
});
var SHA256$3 = /^[a-f0-9]{64}$/u;
var SIGNED_INTEGER = /^-?(?:0|[1-9][0-9]*)$/u;
var ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
var DURATION_UNITS = /* @__PURE__ */ new Set([
	"nanoseconds",
	"microseconds",
	"milliseconds",
	"seconds",
	"minutes",
	"hours",
	"days"
]);
var TRAJECTORY_DURATION_UNITS = /* @__PURE__ */ new Set([
	"milliseconds",
	"seconds",
	"minutes",
	"hours",
	"days",
	"weeks"
]);
function contractError$1(path, message) {
	throw new TypeError(`${path}: ${message}`);
}
function objectAt$1(value, path) {
	if (!value || typeof value !== "object" || Array.isArray(value)) contractError$1(path, "must be an object");
	return value;
}
function exactFields$2(value, fields, path) {
	const allowed = new Set(fields);
	const unknown = Object.keys(value).filter((field) => !allowed.has(field));
	if (unknown.length > 0) contractError$1(path, `contains unknown field ${JSON.stringify(unknown[0])}`);
	const missing = fields.filter((field) => !Object.hasOwn(value, field));
	if (missing.length > 0) contractError$1(path, `is missing required field ${JSON.stringify(missing[0])}`);
}
function allowedFields(value, allowedFieldsList, requiredFieldsList, path) {
	const allowed = new Set(allowedFieldsList);
	const unknown = Object.keys(value).filter((field) => !allowed.has(field));
	if (unknown.length > 0) contractError$1(path, `contains unknown field ${JSON.stringify(unknown[0])}`);
	const missing = requiredFieldsList.filter((field) => !Object.hasOwn(value, field));
	if (missing.length > 0) contractError$1(path, `is missing required field ${JSON.stringify(missing[0])}`);
}
function nonEmptyString$2(value, path) {
	if (typeof value !== "string" || value.trim() === "") contractError$1(path, "must be a non-empty string");
	return value;
}
function validateSignedInteger(value, path) {
	if (!SIGNED_INTEGER.test(value)) contractError$1(path, "must be a canonical signed decimal integer");
	return BigInt(value);
}
function validateInt64(value, path) {
	const parsed = validateSignedInteger(value, path);
	if (parsed < -9223372036854775808n || parsed > 9223372036854775807n) contractError$1(path, "must fit signed int64");
}
function validateDate(value, path) {
	const match = ISO_DATE.exec(value);
	if (!match) contractError$1(path, "must be an ISO calendar date YYYY-MM-DD");
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const instant = /* @__PURE__ */ new Date(0);
	instant.setUTCHours(0, 0, 0, 0);
	instant.setUTCFullYear(year, month - 1, day);
	if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) contractError$1(path, "must be a real calendar date");
}
function assertTaskOwnerV1(value, path = "owner") {
	const owner = objectAt$1(value, path);
	exactFields$2(owner, [
		"contractVersion",
		"datasetHash",
		"specHash",
		"runId",
		"taskId"
	], path);
	if (owner.contractVersion !== "3dena.contract.v1") contractError$1(`${path}.contractVersion`, `must be ${ANALYSIS_CONTRACT_VERSION_V1}`);
	for (const field of ["datasetHash", "specHash"]) {
		const hash = nonEmptyString$2(owner[field], `${path}.${field}`);
		if (!SHA256$3.test(hash)) contractError$1(`${path}.${field}`, "must be a lowercase SHA-256 hex digest");
	}
	nonEmptyString$2(owner.runId, `${path}.runId`);
	nonEmptyString$2(owner.taskId, `${path}.taskId`);
}
function assertDatasetReceiptV1(value, path = "receipt") {
	const receipt = objectAt$1(value, path);
	exactFields$2(receipt, [
		"schemaVersion",
		"sha256",
		"byteLength",
		"format",
		"sheet",
		"rows",
		"columns",
		"schema",
		"limits",
		"warnings",
		"activationIdentity"
	], path);
	if (receipt.schemaVersion !== "3dena.dataset-receipt.v1") contractError$1(`${path}.schemaVersion`, `must be ${DATASET_RECEIPT_VERSION_V1}`);
	if (typeof receipt.sha256 !== "string" || !SHA256$3.test(receipt.sha256)) contractError$1(`${path}.sha256`, "must be a lowercase SHA-256 hex digest");
	for (const field of [
		"byteLength",
		"rows",
		"columns"
	]) if (!Number.isSafeInteger(receipt[field]) || receipt[field] < 1) contractError$1(`${path}.${field}`, "must be a positive safe integer");
	if (![
		"csv",
		"xlsx",
		"xls",
		"ena3d-json"
	].includes(receipt.format)) contractError$1(`${path}.format`, "is unsupported");
	if (receipt.sheet !== null) {
		const sheet = objectAt$1(receipt.sheet, `${path}.sheet`);
		exactFields$2(sheet, ["index", "name"], `${path}.sheet`);
		if (!Number.isSafeInteger(sheet.index) || sheet.index < 0) contractError$1(`${path}.sheet.index`, "must be a non-negative safe integer");
		nonEmptyString$2(sheet.name, `${path}.sheet.name`);
	}
	const schema = objectAt$1(receipt.schema, `${path}.schema`);
	exactFields$2(schema, [
		"schemaVersion",
		"headers",
		"columns"
	], `${path}.schema`);
	if (schema.schemaVersion !== "3dena.dataset-schema.v1") contractError$1(`${path}.schema.schemaVersion`, "must be 3dena.dataset-schema.v1");
	const headers = stringList$1(schema.headers, `${path}.schema.headers`);
	if (headers.length !== receipt.columns) contractError$1(`${path}.schema.headers`, "length must equal receipt.columns");
	if (!Array.isArray(schema.columns) || schema.columns.length !== receipt.columns) contractError$1(`${path}.schema.columns`, "length must equal receipt.columns");
	const allowedTypes = /* @__PURE__ */ new Set([
		"string",
		"number",
		"boolean",
		"mixed",
		"null"
	]);
	const allowedRoles = /* @__PURE__ */ new Set([
		"unit",
		"conversation",
		"time",
		"code",
		"group",
		"metadata",
		"unmapped"
	]);
	schema.columns.forEach((candidate, index) => {
		const column = objectAt$1(candidate, `${path}.schema.columns[${index}]`);
		exactFields$2(column, [
			"name",
			"inferredType",
			"roles"
		], `${path}.schema.columns[${index}]`);
		if (nonEmptyString$2(column.name, `${path}.schema.columns[${index}].name`) !== headers[index]) contractError$1(`${path}.schema.columns[${index}].name`, "must match the ordered header at the same index");
		if (!allowedTypes.has(column.inferredType)) contractError$1(`${path}.schema.columns[${index}].inferredType`, "is unsupported");
		if (!Array.isArray(column.roles) || column.roles.length === 0 || column.roles.some((role) => !allowedRoles.has(role))) contractError$1(`${path}.schema.columns[${index}].roles`, "must be a non-empty array of supported roles");
		if (new Set(column.roles).size !== column.roles.length) contractError$1(`${path}.schema.columns[${index}].roles`, "must not contain duplicates");
		if (column.roles.includes("unmapped") && column.roles.length !== 1) contractError$1(`${path}.schema.columns[${index}].roles`, "unmapped must stand alone");
	});
	const limits = objectAt$1(receipt.limits, `${path}.limits`);
	exactFields$2(limits, [
		"schemaVersion",
		"maxFileBytes",
		"maxWorksheets",
		"maxRows",
		"maxColumns",
		"maxCells"
	], `${path}.limits`);
	if (limits.schemaVersion !== "3dena.dataset-limits.v1") contractError$1(`${path}.limits.schemaVersion`, "must be 3dena.dataset-limits.v1");
	for (const field of [
		"maxFileBytes",
		"maxWorksheets",
		"maxRows",
		"maxColumns",
		"maxCells"
	]) if (!Number.isSafeInteger(limits[field]) || limits[field] < 1) contractError$1(`${path}.limits.${field}`, "must be a positive safe integer");
	if (receipt.byteLength > limits.maxFileBytes) contractError$1(`${path}.byteLength`, "exceeds the activated limits contract");
	if (receipt.rows > limits.maxRows) contractError$1(`${path}.rows`, "exceeds the activated limits contract");
	if (receipt.columns > limits.maxColumns) contractError$1(`${path}.columns`, "exceeds the activated limits contract");
	const cells = receipt.rows * receipt.columns;
	if (!Number.isSafeInteger(cells) || cells > limits.maxCells) contractError$1(`${path}.rows`, "implies cells above the activated limits contract");
	if (!Array.isArray(receipt.warnings) || receipt.warnings.some((warning) => typeof warning !== "string")) contractError$1(`${path}.warnings`, "must be a string array");
	if (new Set(receipt.warnings).size !== receipt.warnings.length) contractError$1(`${path}.warnings`, "must not contain duplicates");
	nonEmptyString$2(receipt.activationIdentity, `${path}.activationIdentity`);
}
function lowercaseSha256(value, path) {
	if (typeof value !== "string" || !SHA256$3.test(value)) contractError$1(path, "must be a lowercase SHA-256 hex digest");
	return value;
}
function stringPair(value, path) {
	if (!Array.isArray(value) || value.length !== 2) contractError$1(path, "must contain exactly two strings");
	const left = nonEmptyString$2(value[0], `${path}[0]`);
	const right = nonEmptyString$2(value[1], `${path}[1]`);
	if (left === right) contractError$1(path, "must contain two different values");
	return [left, right];
}
function stringList$1(value, path, minimum = 1) {
	if (!Array.isArray(value) || value.length < minimum) contractError$1(path, `must contain at least ${minimum} strings`);
	const output = value.map((entry, index) => nonEmptyString$2(entry, `${path}[${index}]`));
	if (new Set(output).size !== output.length) contractError$1(path, "must not contain duplicates");
	return output;
}
function rawScalar(value, path) {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value !== "number" || !Number.isFinite(value)) contractError$1(path, "must be a finite JSON scalar or null");
	if (Number.isInteger(value) && !Number.isSafeInteger(value)) contractError$1(path, "unsafe integer identities must be supplied as strings");
}
function assertPreparedMapping(value, path) {
	const mapping = objectAt$1(value, path);
	exactFields$2(mapping, [
		"participant",
		"participantLabel",
		"group",
		"time",
		"timeOrder",
		"cohortPolicy",
		"displayDimensions",
		"missingDisplayCoordinates"
	], path);
	stringList$1(mapping.participant, `${path}.participant`);
	nonEmptyString$2(mapping.participantLabel, `${path}.participantLabel`);
	nonEmptyString$2(mapping.group, `${path}.group`);
	nonEmptyString$2(mapping.time, `${path}.time`);
	if (!Array.isArray(mapping.timeOrder) || mapping.timeOrder.length === 0) contractError$1(`${path}.timeOrder`, "must contain at least one ordered period");
	mapping.timeOrder.forEach((candidate, index) => rawScalar(candidate, `${path}.timeOrder[${index}]`));
	if (mapping.cohortPolicy !== "available" && mapping.cohortPolicy !== "complete") contractError$1(`${path}.cohortPolicy`, "must be available or complete");
	if (stringList$1(mapping.displayDimensions, `${path}.displayDimensions`, 3).length !== 3) contractError$1(`${path}.displayDimensions`, "must contain exactly three dimensions");
	if (mapping.missingDisplayCoordinates !== "reject") contractError$1(`${path}.missingDisplayCoordinates`, "must be reject");
}
function trajectoryDurationUnit(value, path) {
	if (typeof value !== "string" || !TRAJECTORY_DURATION_UNITS.has(value)) contractError$1(path, "must be milliseconds, seconds, minutes, hours, days, or weeks");
}
function assertTrajectoryTimeValue(value, path) {
	const time = objectAt$1(value, path);
	const type = nonEmptyString$2(time.type, `${path}.type`);
	switch (type) {
		case "numeric-v1":
			exactFields$2(time, [
				"type",
				"value",
				"unit"
			], path);
			if (typeof time.value !== "number" || !Number.isFinite(time.value)) contractError$1(`${path}.value`, "must be finite");
			nonEmptyString$2(time.unit, `${path}.unit`);
			return;
		case "date-v1":
			exactFields$2(time, ["type", "value"], path);
			validateDate(nonEmptyString$2(time.value, `${path}.value`), `${path}.value`);
			return;
		case "instant-v1":
			exactFields$2(time, [
				"type",
				"epochMilliseconds",
				"timeZone",
				"offsetMinutes",
				"fold",
				"elapsedUnit"
			], path);
			validateInt64(nonEmptyString$2(time.epochMilliseconds, `${path}.epochMilliseconds`), `${path}.epochMilliseconds`);
			nonEmptyString$2(time.timeZone, `${path}.timeZone`);
			if (!Number.isInteger(time.offsetMinutes) || time.offsetMinutes < -1440 || time.offsetMinutes > 1440) contractError$1(`${path}.offsetMinutes`, "must be an integer from -1440 through 1440");
			if (time.fold !== 0 && time.fold !== 1) contractError$1(`${path}.fold`, "must be 0 or 1");
			trajectoryDurationUnit(time.elapsedUnit, `${path}.elapsedUnit`);
			return;
		case "difftime-v1":
			exactFields$2(time, [
				"type",
				"value",
				"unit",
				"elapsedUnit"
			], path);
			if (typeof time.value !== "number" || !Number.isFinite(time.value)) contractError$1(`${path}.value`, "must be finite");
			trajectoryDurationUnit(time.unit, `${path}.unit`);
			trajectoryDurationUnit(time.elapsedUnit, `${path}.elapsedUnit`);
			return;
		default: contractError$1(`${path}.type`, `unsupported trajectory time type ${JSON.stringify(type)}`);
	}
}
/** Strict runtime validator shared by SDK, remote client, service, and Worker. */
function assertAnalysisTaskV1(value, path = "task") {
	const task = objectAt$1(value, path);
	if (task.schemaVersion !== "3dena.analysis-task.v1") contractError$1(`${path}.schemaVersion`, `must be ${ANALYSIS_TASK_VERSION_V1}`);
	assertTaskOwnerV1(task.owner, `${path}.owner`);
	if (!Number.isSafeInteger(task.deadlineEpochMilliseconds) || task.deadlineEpochMilliseconds < 0) contractError$1(`${path}.deadlineEpochMilliseconds`, "must be a non-negative safe integer");
	const kind = nonEmptyString$2(task.kind, `${path}.kind`);
	const base = [
		"schemaVersion",
		"kind",
		"owner",
		"deadlineEpochMilliseconds"
	];
	switch (kind) {
		case "ena-model":
			exactFields$2(task, [...base, "input"], path);
			objectAt$1(task.input, `${path}.input`);
			return;
		case "prepared-import": {
			exactFields$2(task, [...base, "input"], path);
			const input = objectAt$1(task.input, `${path}.input`);
			exactFields$2(input, [
				"sourceName",
				"exactBytesBase64",
				"mapping"
			], `${path}.input`);
			if (input.sourceName !== "uploaded.ena3d.json") contractError$1(`${path}.input.sourceName`, "must be the non-identifying service source name");
			if (typeof input.exactBytesBase64 !== "string" || input.exactBytesBase64.length < 4 || input.exactBytesBase64.length > 7e6 || input.exactBytesBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(input.exactBytesBase64)) contractError$1(`${path}.input.exactBytesBase64`, "must be bounded canonical base64");
			assertPreparedMapping(input.mapping, `${path}.input.mapping`);
			return;
		}
		case "network-comparison":
			exactFields$2(task, [
				...base,
				"sourceResultHash",
				"groups"
			], path);
			lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
			stringPair(task.groups, `${path}.groups`);
			return;
		case "change-network":
			exactFields$2(task, [
				...base,
				"sourceResultHash",
				"field",
				"level"
			], path);
			lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
			nonEmptyString$2(task.field, `${path}.field`);
			rawScalar(task.level, `${path}.level`);
			return;
		case "statistics":
			exactFields$2(task, [
				...base,
				"sourceResultHash",
				"design",
				"groups",
				"dimensions",
				"alternative",
				"adjustment",
				"samePhysicalEntityConfirmed"
			], path);
			lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
			if (task.design !== "independent" && task.design !== "paired") contractError$1(`${path}.design`, "must be independent or paired");
			stringPair(task.groups, `${path}.groups`);
			stringList$1(task.dimensions, `${path}.dimensions`);
			if (![
				"two-sided",
				"greater",
				"less"
			].includes(task.alternative)) contractError$1(`${path}.alternative`, "is unsupported");
			if (![
				"none",
				"holm",
				"bh",
				"bonferroni"
			].includes(task.adjustment)) contractError$1(`${path}.adjustment`, "is unsupported");
			if (typeof task.samePhysicalEntityConfirmed !== "boolean") contractError$1(`${path}.samePhysicalEntityConfirmed`, "must be boolean");
			if (task.design === "paired" && task.samePhysicalEntityConfirmed !== true) contractError$1(`${path}.samePhysicalEntityConfirmed`, "must be true for paired statistics");
			if (task.design === "independent" && task.samePhysicalEntityConfirmed !== false) contractError$1(`${path}.samePhysicalEntityConfirmed`, "must be false for independent statistics");
			return;
		case "trajectory":
			exactFields$2(task, [
				...base,
				"sourceResultHash",
				"group",
				"selectedDimensions",
				"cohortPolicy",
				"periods",
				"estimand"
			], path);
			lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
			nonEmptyString$2(task.group, `${path}.group`);
			if (stringList$1(task.selectedDimensions, `${path}.selectedDimensions`, 3).length !== 3) contractError$1(`${path}.selectedDimensions`, "must contain exactly three dimensions");
			if (task.cohortPolicy !== "available" && task.cohortPolicy !== "complete") contractError$1(`${path}.cohortPolicy`, "must be available or complete");
			if (!Array.isArray(task.periods) || task.periods.length === 0) contractError$1(`${path}.periods`, "must contain at least one period");
			{
				const seen = /* @__PURE__ */ new Set();
				task.periods.forEach((candidate, index) => {
					const period = objectAt$1(candidate, `${path}.periods[${index}]`);
					exactFields$2(period, ["sourceTimeCanonical", "value"], `${path}.periods[${index}]`);
					const canonical = nonEmptyString$2(period.sourceTimeCanonical, `${path}.periods[${index}].sourceTimeCanonical`);
					if (seen.has(canonical)) contractError$1(`${path}.periods[${index}].sourceTimeCanonical`, "duplicates an earlier source time key");
					seen.add(canonical);
					assertTrajectoryTimeValue(period.value, `${path}.periods[${index}].value`);
				});
			}
			{
				const estimand = objectAt$1(task.estimand, `${path}.estimand`);
				if (estimand.kind === "equal-participant-v1") exactFields$2(estimand, ["kind"], `${path}.estimand`);
				else if (estimand.kind === "weighted-participant-v1") {
					exactFields$2(estimand, ["kind", "metadataField"], `${path}.estimand`);
					nonEmptyString$2(estimand.metadataField, `${path}.estimand.metadataField`);
				} else contractError$1(`${path}.estimand.kind`, "must be equal-participant-v1 or weighted-participant-v1");
			}
			return;
		case "trajectory-comparison":
			exactFields$2(task, [
				...base,
				"sourceResultHash",
				"design",
				"groups",
				"samePhysicalEntityConfirmed"
			], path);
			lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
			if (task.design !== "independent" && task.design !== "paired") contractError$1(`${path}.design`, "must be independent or paired");
			stringPair(task.groups, `${path}.groups`);
			if (typeof task.samePhysicalEntityConfirmed !== "boolean") contractError$1(`${path}.samePhysicalEntityConfirmed`, "must be boolean");
			if (task.design === "paired" && task.samePhysicalEntityConfirmed !== true) contractError$1(`${path}.samePhysicalEntityConfirmed`, "must be true for paired comparison");
			return;
		case "bootstrap":
			exactFields$2(task, [
				...base,
				"sourceResultHash",
				"group",
				"replicates",
				"confidenceLevel",
				"seed",
				"interval",
				"rotationPolicy"
			], path);
			lowercaseSha256(task.sourceResultHash, `${path}.sourceResultHash`);
			nonEmptyString$2(task.group, `${path}.group`);
			if (!Number.isSafeInteger(task.replicates) || task.replicates < 200 || task.replicates > 500) contractError$1(`${path}.replicates`, "must be a safe integer from 200 through 500");
			if (typeof task.confidenceLevel !== "number" || !Number.isFinite(task.confidenceLevel) || task.confidenceLevel <= 0 || task.confidenceLevel >= 1) contractError$1(`${path}.confidenceLevel`, "must be finite and strictly between 0 and 1");
			if (!Number.isSafeInteger(task.seed) || task.seed < 0 || task.seed > 4294967295) contractError$1(`${path}.seed`, "must be an unsigned 32-bit integer");
			if (task.interval !== "pointwise-percentile-type7") contractError$1(`${path}.interval`, "is unsupported in task v1");
			if (task.rotationPolicy !== "fixed-preprojected") contractError$1(`${path}.rotationPolicy`, "is unsupported in task v1");
			return;
		default: contractError$1(`${path}.kind`, `unsupported analysis task ${JSON.stringify(kind)}`);
	}
}
function assertEvidenceStampV1(value, path = "evidence") {
	const evidence = objectAt$1(value, path);
	allowedFields(evidence, [
		"schemaVersion",
		"scope",
		"status",
		"datasetHash",
		"specHash",
		"fixtureId",
		"buildId",
		"approvedForParity"
	], [
		"schemaVersion",
		"scope",
		"status",
		"approvedForParity"
	], path);
	if (evidence.schemaVersion !== "3dena.evidence-stamp.v1") contractError$1(`${path}.schemaVersion`, "must be 3dena.evidence-stamp.v1");
	if (!(evidence.scope === "fixture" || evidence.scope === "feature" || evidence.scope === "build" || evidence.scope === "deployment")) contractError$1(`${path}.scope`, "is unsupported");
	if (!(/* @__PURE__ */ new Set([
		"IMPLEMENTED_UNVERIFIED",
		"PARITY_CANDIDATE",
		"VERIFIED_PARITY",
		"PRODUCTION_CANDIDATE",
		"PRODUCTION_READY",
		"PRECOMPUTED_COMPATIBILITY_CANDIDATE"
	])).has(evidence.status)) contractError$1(`${path}.status`, "is unsupported");
	if (typeof evidence.approvedForParity !== "boolean") contractError$1(`${path}.approvedForParity`, "must be boolean");
	for (const field of ["datasetHash", "specHash"]) if (evidence[field] !== void 0) lowercaseSha256(evidence[field], `${path}.${field}`);
	for (const field of ["fixtureId", "buildId"]) if (evidence[field] !== void 0) nonEmptyString$2(evidence[field], `${path}.${field}`);
	if (evidence.scope === "fixture") {
		for (const field of [
			"datasetHash",
			"specHash",
			"fixtureId"
		]) if (evidence[field] === void 0) contractError$1(`${path}.${field}`, "is required for fixture-scoped evidence");
	}
	if ((evidence.scope === "build" || evidence.scope === "deployment") && evidence.buildId === void 0) contractError$1(`${path}.buildId`, `is required for ${evidence.scope}-scoped evidence`);
	if (evidence.approvedForParity === true && ![
		"VERIFIED_PARITY",
		"PRODUCTION_CANDIDATE",
		"PRODUCTION_READY"
	].includes(evidence.status)) contractError$1(`${path}.approvedForParity`, "cannot be true below VERIFIED_PARITY");
}
function assertAnalysisResultEnvelopeV1(value, path = "envelope") {
	const envelope = objectAt$1(value, path);
	exactFields$2(envelope, [
		"schemaVersion",
		"owner",
		"taskKind",
		"result",
		"diagnostics",
		"evidence",
		"provenance"
	], path);
	if (envelope.schemaVersion !== "3dena.analysis-result-envelope.v1") contractError$1(`${path}.schemaVersion`, `must be ${RESULT_ENVELOPE_VERSION_V1}`);
	assertTaskOwnerV1(envelope.owner, `${path}.owner`);
	if (![
		"ena-model",
		"prepared-import",
		"network-comparison",
		"change-network",
		"statistics",
		"trajectory",
		"trajectory-comparison",
		"bootstrap"
	].includes(envelope.taskKind)) contractError$1(`${path}.taskKind`, "is unsupported");
	const taskKind = envelope.taskKind;
	const expectedResultSchemaVersion = RESULT_SCHEMA_VERSION_BY_TASK_KIND_V1[taskKind];
	const result = objectAt$1(envelope.result, `${path}.result`);
	if (result.schemaVersion !== expectedResultSchemaVersion) contractError$1(`${path}.result.schemaVersion`, `must be ${expectedResultSchemaVersion} for taskKind ${taskKind}`);
	assertAnalysisTaskResultV1(result, taskKind, `${path}.result`);
	if (!Array.isArray(envelope.diagnostics)) contractError$1(`${path}.diagnostics`, "must be an array");
	envelope.diagnostics.forEach((candidate, index) => {
		const diagnostic = objectAt$1(candidate, `${path}.diagnostics[${index}]`);
		allowedFields(diagnostic, [
			"code",
			"severity",
			"message",
			"path",
			"count"
		], [
			"code",
			"severity",
			"message"
		], `${path}.diagnostics[${index}]`);
		nonEmptyString$2(diagnostic.code, `${path}.diagnostics[${index}].code`);
		if (diagnostic.severity !== "info" && diagnostic.severity !== "warning") contractError$1(`${path}.diagnostics[${index}].severity`, "is unsupported");
		nonEmptyString$2(diagnostic.message, `${path}.diagnostics[${index}].message`);
		if (diagnostic.path !== void 0) nonEmptyString$2(diagnostic.path, `${path}.diagnostics[${index}].path`);
		if (diagnostic.count !== void 0 && (!Number.isSafeInteger(diagnostic.count) || diagnostic.count < 0)) contractError$1(`${path}.diagnostics[${index}].count`, "must be a non-negative safe integer");
	});
	assertEvidenceStampV1(envelope.evidence, `${path}.evidence`);
	assertProvenanceManifestV1(envelope.provenance, `${path}.provenance`);
	const owner = envelope.owner;
	const provenance = envelope.provenance;
	const evidence = envelope.evidence;
	if (owner.datasetHash !== provenance.datasetHash || owner.specHash !== provenance.specHash) contractError$1(`${path}.provenance`, "dataset/spec ownership does not match envelope.owner");
	if (evidence.datasetHash !== void 0 && evidence.datasetHash !== owner.datasetHash) contractError$1(`${path}.evidence.datasetHash`, "does not match envelope.owner");
	if (evidence.specHash !== void 0 && evidence.specHash !== owner.specHash) contractError$1(`${path}.evidence.specHash`, "does not match envelope.owner");
	for (const requiredSchemaVersion of [
		ANALYSIS_TASK_VERSION_V1,
		expectedResultSchemaVersion,
		RESULT_ENVELOPE_VERSION_V1
	]) if (!provenance.schemaVersions.includes(requiredSchemaVersion)) contractError$1(`${path}.provenance.schemaVersions`, `must include ${requiredSchemaVersion}`);
}
function finiteNumber(value, path) {
	if (typeof value !== "number" || !Number.isFinite(value)) contractError$1(path, "must be a finite number");
	return value;
}
function finiteOrNull(value, path) {
	if (value === null) return null;
	return finiteNumber(value, path);
}
function nonNegativeInteger(value, path) {
	if (!Number.isSafeInteger(value) || value < 0) contractError$1(path, "must be a non-negative safe integer");
	return value;
}
function positiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value < 1) contractError$1(path, "must be a positive safe integer");
	return value;
}
function finiteVector(value, path, length) {
	if (!Array.isArray(value)) contractError$1(path, "must be an array");
	if (length !== void 0 && value.length !== length) contractError$1(path, `must contain exactly ${length} values`);
	return value.map((entry, index) => finiteNumber(entry, `${path}[${index}]`));
}
function optionalFiniteVector(value, path, length) {
	if (value === null) return null;
	return finiteVector(value, path, length);
}
function sameOrderedStrings(actual, expected, path) {
	if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) contractError$1(path, "must preserve the declared order exactly");
}
function assertRawEntityKey(value, path) {
	const key = objectAt$1(value, path);
	exactFields$2(key, [
		"canonical",
		"display",
		"columns",
		"values"
	], path);
	const canonical = nonEmptyString$2(key.canonical, `${path}.canonical`);
	if (typeof key.display !== "string") contractError$1(`${path}.display`, "must be a string");
	const columns = stringList$1(key.columns, `${path}.columns`);
	if (!Array.isArray(key.values) || key.values.length !== columns.length) contractError$1(`${path}.values`, "must align one-to-one with columns");
	key.values.forEach((entry, index) => rawScalar(entry, `${path}.values[${index}]`));
	return {
		canonical,
		columns,
		values: key.values
	};
}
function assertRawTypedValue(value, path) {
	const typed = objectAt$1(value, path);
	exactFields$2(typed, [
		"canonical",
		"display",
		"value"
	], path);
	const canonical = nonEmptyString$2(typed.canonical, `${path}.canonical`);
	if (typeof typed.display !== "string") contractError$1(`${path}.display`, "must be a string");
	rawScalar(typed.value, `${path}.value`);
	return { canonical };
}
function assertDiagnostic(value, path) {
	const diagnostic = objectAt$1(value, path);
	allowedFields(diagnostic, [
		"code",
		"severity",
		"message",
		"path",
		"count"
	], [
		"code",
		"severity",
		"message"
	], path);
	nonEmptyString$2(diagnostic.code, `${path}.code`);
	if (diagnostic.severity !== "info" && diagnostic.severity !== "warning") contractError$1(`${path}.severity`, "must be info or warning");
	nonEmptyString$2(diagnostic.message, `${path}.message`);
	if (diagnostic.path !== void 0) nonEmptyString$2(diagnostic.path, `${path}.path`);
	if (diagnostic.count !== void 0) nonNegativeInteger(diagnostic.count, `${path}.count`);
}
function assertDiagnostics(value, path) {
	if (!Array.isArray(value)) contractError$1(path, "must be an array");
	value.forEach((entry, index) => assertDiagnostic(entry, `${path}[${index}]`));
}
function assertAnalysisResult(value, path) {
	const result = objectAt$1(value, path);
	allowedFields(result, [
		"schemaVersion",
		"dimensions",
		"axes",
		"points",
		"nodes",
		"edges",
		"accumulation",
		"variance",
		"rotation",
		"trajectory",
		"summary",
		"diagnostics",
		"provenance"
	], [
		"schemaVersion",
		"dimensions",
		"axes",
		"points",
		"nodes",
		"edges",
		"accumulation",
		"variance",
		"rotation",
		"summary",
		"diagnostics",
		"provenance"
	], path);
	if (result.schemaVersion !== "3dena.analysis-result.v1") contractError$1(`${path}.schemaVersion`, "must be 3dena.analysis-result.v1");
	const dimensions = stringList$1(result.dimensions, `${path}.dimensions`, 3);
	if (new Set(dimensions).size !== dimensions.length) contractError$1(`${path}.dimensions`, "must not contain duplicates");
	const axes = stringList$1(result.axes, `${path}.axes`, 3);
	if (axes.length !== 3 || axes.some((axis, index) => axis !== dimensions[index])) contractError$1(`${path}.axes`, "must be the first three fitted rotation dimensions in order");
	if (!Array.isArray(result.edges) || result.edges.length === 0) contractError$1(`${path}.edges`, "must be a non-empty array");
	const edgeColumns = [];
	const edgeIds = /* @__PURE__ */ new Set();
	result.edges.forEach((candidate, index) => {
		const edge = objectAt$1(candidate, `${path}.edges[${index}]`);
		exactFields$2(edge, [
			"index",
			"id",
			"column",
			"source",
			"target",
			"sourceIndex",
			"targetIndex",
			"meanWeight"
		], `${path}.edges[${index}]`);
		if (nonNegativeInteger(edge.index, `${path}.edges[${index}].index`) !== index) contractError$1(`${path}.edges[${index}].index`, "must equal its array position");
		const id = nonEmptyString$2(edge.id, `${path}.edges[${index}].id`);
		if (edgeIds.has(id)) contractError$1(`${path}.edges[${index}].id`, "duplicates an earlier edge identity");
		edgeIds.add(id);
		edgeColumns.push(nonEmptyString$2(edge.column, `${path}.edges[${index}].column`));
		nonEmptyString$2(edge.source, `${path}.edges[${index}].source`);
		nonEmptyString$2(edge.target, `${path}.edges[${index}].target`);
		nonNegativeInteger(edge.sourceIndex, `${path}.edges[${index}].sourceIndex`);
		nonNegativeInteger(edge.targetIndex, `${path}.edges[${index}].targetIndex`);
		finiteNumber(edge.meanWeight, `${path}.edges[${index}].meanWeight`);
	});
	if (new Set(edgeColumns).size !== edgeColumns.length) contractError$1(`${path}.edges`, "edge columns must be unique");
	if (!Array.isArray(result.nodes) || result.nodes.length < 3) contractError$1(`${path}.nodes`, "must contain at least three nodes");
	const nodeCodes = [];
	result.nodes.forEach((candidate, index) => {
		const node = objectAt$1(candidate, `${path}.nodes[${index}]`);
		exactFields$2(node, [
			"index",
			"code",
			"coordinates",
			"fullCoordinates"
		], `${path}.nodes[${index}]`);
		if (nonNegativeInteger(node.index, `${path}.nodes[${index}].index`) !== index) contractError$1(`${path}.nodes[${index}].index`, "must equal its array position");
		nodeCodes.push(nonEmptyString$2(node.code, `${path}.nodes[${index}].code`));
		finiteVector(node.coordinates, `${path}.nodes[${index}].coordinates`, 3);
		finiteVector(node.fullCoordinates, `${path}.nodes[${index}].fullCoordinates`, dimensions.length);
	});
	if (new Set(nodeCodes).size !== nodeCodes.length) contractError$1(`${path}.nodes`, "node codes must be unique");
	result.edges.forEach((candidate, index) => {
		const edge = candidate;
		const sourceIndex = edge.sourceIndex;
		const targetIndex = edge.targetIndex;
		if (nodeCodes[sourceIndex] !== edge.source || nodeCodes[targetIndex] !== edge.target) contractError$1(`${path}.edges[${index}]`, "node indexes and code identities must align");
	});
	if (!Array.isArray(result.points) || result.points.length === 0) contractError$1(`${path}.points`, "must be a non-empty array");
	const pointIds = /* @__PURE__ */ new Set();
	result.points.forEach((candidate, index) => {
		const point = objectAt$1(candidate, `${path}.points[${index}]`);
		allowedFields(point, [
			"index",
			"id",
			"unit",
			"participantLabel",
			"step",
			"group",
			"time",
			"coordinates",
			"fullCoordinates",
			"lineWeights",
			"metadata"
		], [
			"index",
			"id",
			"unit",
			"participantLabel",
			"coordinates",
			"fullCoordinates",
			"lineWeights",
			"metadata"
		], `${path}.points[${index}]`);
		if (nonNegativeInteger(point.index, `${path}.points[${index}].index`) !== index) contractError$1(`${path}.points[${index}].index`, "must equal its array position");
		const pointId = assertRawEntityKey(point.id, `${path}.points[${index}].id`).canonical;
		if (pointIds.has(pointId)) contractError$1(`${path}.points[${index}].id`, "duplicates an earlier point identity");
		pointIds.add(pointId);
		assertRawEntityKey(point.unit, `${path}.points[${index}].unit`);
		assertRawEntityKey(point.participantLabel, `${path}.points[${index}].participantLabel`);
		if (point.step !== void 0) assertRawEntityKey(point.step, `${path}.points[${index}].step`);
		if (point.group !== void 0) assertRawTypedValue(point.group, `${path}.points[${index}].group`);
		if (point.time !== void 0) assertRawTypedValue(point.time, `${path}.points[${index}].time`);
		finiteVector(point.coordinates, `${path}.points[${index}].coordinates`, 3);
		finiteVector(point.fullCoordinates, `${path}.points[${index}].fullCoordinates`, dimensions.length);
		finiteVector(point.lineWeights, `${path}.points[${index}].lineWeights`, edgeColumns.length);
		const metadata = objectAt$1(point.metadata, `${path}.points[${index}].metadata`);
		for (const [field, entry] of Object.entries(metadata)) rawScalar(entry, `${path}.points[${index}].metadata.${field}`);
	});
	const accumulation = objectAt$1(result.accumulation, `${path}.accumulation`);
	exactFields$2(accumulation, ["modelCounts", "rowCounts"], `${path}.accumulation`);
	for (const tableName of ["modelCounts", "rowCounts"]) {
		const table = objectAt$1(accumulation[tableName], `${path}.accumulation.${tableName}`);
		exactFields$2(table, [
			"rowKeys",
			"columns",
			"values"
		], `${path}.accumulation.${tableName}`);
		const columns = stringList$1(table.columns, `${path}.accumulation.${tableName}.columns`);
		if (tableName === "modelCounts") sameOrderedStrings(columns, edgeColumns, `${path}.accumulation.${tableName}.columns`);
		else sameOrderedStrings(columns.slice(columns.length - edgeColumns.length), edgeColumns, `${path}.accumulation.${tableName}.columns`);
		if (!Array.isArray(table.rowKeys) || !Array.isArray(table.values) || table.rowKeys.length !== table.values.length) contractError$1(`${path}.accumulation.${tableName}`, "rowKeys and values must align");
		table.rowKeys.forEach((entry, index) => {
			assertRawEntityKey(entry, `${path}.accumulation.${tableName}.rowKeys[${index}]`);
			finiteVector(table.values[index], `${path}.accumulation.${tableName}.values[${index}]`, columns.length);
		});
	}
	if (!Array.isArray(result.variance) || result.variance.length !== dimensions.length) contractError$1(`${path}.variance`, "must align one-to-one with dimensions");
	result.variance.forEach((candidate, index) => {
		const variance = objectAt$1(candidate, `${path}.variance[${index}]`);
		exactFields$2(variance, [
			"axis",
			"proportion",
			"eigenvalue",
			"displayed"
		], `${path}.variance[${index}]`);
		if (variance.axis !== dimensions[index]) contractError$1(`${path}.variance[${index}].axis`, "must match the dimension at this index");
		finiteNumber(variance.proportion, `${path}.variance[${index}].proportion`);
		finiteNumber(variance.eigenvalue, `${path}.variance[${index}].eigenvalue`);
		if (typeof variance.displayed !== "boolean") contractError$1(`${path}.variance[${index}].displayed`, "must be boolean");
	});
	const rotation = objectAt$1(result.rotation, `${path}.rotation`);
	exactFields$2(rotation, [
		"method",
		"columns",
		"matrix",
		"eigenvalues",
		"centerVector"
	], `${path}.rotation`);
	if (rotation.method !== "svd" && rotation.method !== "mean" && rotation.method !== "reference") contractError$1(`${path}.rotation.method`, "must be svd, mean, or reference");
	sameOrderedStrings(stringList$1(rotation.columns, `${path}.rotation.columns`), dimensions, `${path}.rotation.columns`);
	if (!Array.isArray(rotation.matrix) || rotation.matrix.length !== edgeColumns.length) contractError$1(`${path}.rotation.matrix`, "must contain one row per edge column");
	rotation.matrix.forEach((row, index) => finiteVector(row, `${path}.rotation.matrix[${index}]`, dimensions.length));
	finiteVector(rotation.eigenvalues, `${path}.rotation.eigenvalues`, dimensions.length);
	finiteVector(rotation.centerVector, `${path}.rotation.centerVector`, edgeColumns.length);
	if (result.trajectory !== void 0) assertSharedTrajectory(result.trajectory, dimensions, result.points, `${path}.trajectory`);
	const summary = objectAt$1(result.summary, `${path}.summary`);
	exactFields$2(summary, [
		"inputRows",
		"inputColumns",
		"units",
		"points",
		"nodes",
		"edges",
		"modelCountRows",
		"rowCountRows",
		"groups",
		"timePoints",
		"participantPeriods",
		"trajectoryCentroids",
		"dimensions"
	], `${path}.summary`);
	for (const field of Object.keys(summary)) nonNegativeInteger(summary[field], `${path}.summary.${field}`);
	if (summary.points !== result.points.length || summary.nodes !== result.nodes.length || summary.edges !== result.edges.length || summary.dimensions !== dimensions.length) contractError$1(`${path}.summary`, "point, node, edge, and dimension counts must match the public tables");
	const modelCounts = accumulation.modelCounts;
	const rowCounts = accumulation.rowCounts;
	if (summary.modelCountRows !== modelCounts.rowKeys.length || summary.rowCountRows !== rowCounts.rowKeys.length) contractError$1(`${path}.summary`, "accumulation row counts must match the public tables");
	assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
	assertAnalysisProvenance(result.provenance, `${path}.provenance`);
}
function assertSharedTrajectory(value, dimensions, points, path) {
	const trajectory = objectAt$1(value, path);
	exactFields$2(trajectory, [
		"space",
		"dimensions",
		"cohortPolicy",
		"groupOrder",
		"timeOrder",
		"participantPeriods",
		"centroids",
		"paths"
	], path);
	if (trajectory.space !== "analysis-result-rotation") contractError$1(`${path}.space`, "must be analysis-result-rotation");
	sameOrderedStrings(stringList$1(trajectory.dimensions, `${path}.dimensions`), dimensions, `${path}.dimensions`);
	if (trajectory.cohortPolicy !== "available" && trajectory.cohortPolicy !== "complete") contractError$1(`${path}.cohortPolicy`, "must be available or complete");
	if (!Array.isArray(trajectory.groupOrder) || !Array.isArray(trajectory.timeOrder)) contractError$1(path, "groupOrder and timeOrder must be arrays");
	const groups = trajectory.groupOrder.map((entry, index) => assertRawTypedValue(entry, `${path}.groupOrder[${index}]`).canonical);
	const times = trajectory.timeOrder.map((entry, index) => assertRawTypedValue(entry, `${path}.timeOrder[${index}]`).canonical);
	if (new Set(groups).size !== groups.length || new Set(times).size !== times.length) contractError$1(path, "group and time inventories must not contain duplicates");
	if (!Array.isArray(trajectory.participantPeriods) || !Array.isArray(trajectory.centroids) || !Array.isArray(trajectory.paths)) contractError$1(path, "trajectory tables must be arrays");
	trajectory.participantPeriods.forEach((candidate, index) => {
		const row = objectAt$1(candidate, `${path}.participantPeriods[${index}]`);
		exactFields$2(row, [
			"index",
			"participant",
			"participantLabel",
			"group",
			"time",
			"coordinates",
			"fullCoordinates",
			"sourcePointIndexes",
			"includedInCohort"
		], `${path}.participantPeriods[${index}]`);
		if (nonNegativeInteger(row.index, `${path}.participantPeriods[${index}].index`) !== index) contractError$1(`${path}.participantPeriods[${index}].index`, "must equal its array position");
		assertRawEntityKey(row.participant, `${path}.participantPeriods[${index}].participant`);
		assertRawEntityKey(row.participantLabel, `${path}.participantPeriods[${index}].participantLabel`);
		if (!groups.includes(assertRawTypedValue(row.group, `${path}.participantPeriods[${index}].group`).canonical)) contractError$1(`${path}.participantPeriods[${index}].group`, "must occur in groupOrder");
		if (!times.includes(assertRawTypedValue(row.time, `${path}.participantPeriods[${index}].time`).canonical)) contractError$1(`${path}.participantPeriods[${index}].time`, "must occur in timeOrder");
		finiteVector(row.coordinates, `${path}.participantPeriods[${index}].coordinates`, 3);
		finiteVector(row.fullCoordinates, `${path}.participantPeriods[${index}].fullCoordinates`, dimensions.length);
		if (!Array.isArray(row.sourcePointIndexes) || row.sourcePointIndexes.length === 0) contractError$1(`${path}.participantPeriods[${index}].sourcePointIndexes`, "must be non-empty");
		row.sourcePointIndexes.forEach((entry, itemIndex) => {
			if (nonNegativeInteger(entry, `${path}.participantPeriods[${index}].sourcePointIndexes[${itemIndex}]`) >= points.length) contractError$1(`${path}.participantPeriods[${index}].sourcePointIndexes[${itemIndex}]`, "is outside the point table");
		});
		if (typeof row.includedInCohort !== "boolean") contractError$1(`${path}.participantPeriods[${index}].includedInCohort`, "must be boolean");
	});
	trajectory.centroids.forEach((candidate, index) => {
		const row = objectAt$1(candidate, `${path}.centroids[${index}]`);
		exactFields$2(row, [
			"index",
			"group",
			"time",
			"coordinates",
			"fullCoordinates",
			"participantCount",
			"participantPeriodIndexes"
		], `${path}.centroids[${index}]`);
		if (nonNegativeInteger(row.index, `${path}.centroids[${index}].index`) !== index) contractError$1(`${path}.centroids[${index}].index`, "must equal its array position");
		if (!groups.includes(assertRawTypedValue(row.group, `${path}.centroids[${index}].group`).canonical)) contractError$1(`${path}.centroids[${index}].group`, "must occur in groupOrder");
		if (!times.includes(assertRawTypedValue(row.time, `${path}.centroids[${index}].time`).canonical)) contractError$1(`${path}.centroids[${index}].time`, "must occur in timeOrder");
		finiteVector(row.coordinates, `${path}.centroids[${index}].coordinates`, 3);
		finiteVector(row.fullCoordinates, `${path}.centroids[${index}].fullCoordinates`, dimensions.length);
		positiveInteger(row.participantCount, `${path}.centroids[${index}].participantCount`);
		if (!Array.isArray(row.participantPeriodIndexes) || row.participantPeriodIndexes.length !== row.participantCount) contractError$1(`${path}.centroids[${index}].participantPeriodIndexes`, "must align with participantCount");
		row.participantPeriodIndexes.forEach((entry, itemIndex) => {
			if (nonNegativeInteger(entry, `${path}.centroids[${index}].participantPeriodIndexes[${itemIndex}]`) >= trajectory.participantPeriods.length) contractError$1(`${path}.centroids[${index}].participantPeriodIndexes[${itemIndex}]`, "is outside the participant-period table");
		});
	});
	trajectory.paths.forEach((candidate, index) => {
		const row = objectAt$1(candidate, `${path}.paths[${index}]`);
		exactFields$2(row, ["group", "steps"], `${path}.paths[${index}]`);
		if (assertRawTypedValue(row.group, `${path}.paths[${index}].group`).canonical !== groups[index]) contractError$1(`${path}.paths[${index}].group`, "must preserve groupOrder");
		if (!Array.isArray(row.steps) || row.steps.length !== times.length) contractError$1(`${path}.paths[${index}].steps`, "must contain every expected time in order");
		row.steps.forEach((candidateStep, stepIndex) => {
			const step = objectAt$1(candidateStep, `${path}.paths[${index}].steps[${stepIndex}]`);
			exactFields$2(step, ["time", "centroidIndex"], `${path}.paths[${index}].steps[${stepIndex}]`);
			if (assertRawTypedValue(step.time, `${path}.paths[${index}].steps[${stepIndex}].time`).canonical !== times[stepIndex]) contractError$1(`${path}.paths[${index}].steps[${stepIndex}].time`, "must preserve timeOrder");
			if (step.centroidIndex !== null) {
				if (nonNegativeInteger(step.centroidIndex, `${path}.paths[${index}].steps[${stepIndex}].centroidIndex`) >= trajectory.centroids.length) contractError$1(`${path}.paths[${index}].steps[${stepIndex}].centroidIndex`, "is outside the centroid table");
			}
		});
	});
}
function assertAnalysisProvenance(value, path) {
	const provenance = objectAt$1(value, path);
	exactFields$2(provenance, [
		"adapter",
		"adapterVersion",
		"jenaPackage",
		"jenaVersion",
		"jenaCommit",
		"coreGoldenContract",
		"legacyGoldenContract",
		"legacyGoldenStatus",
		"parityContract",
		"resultSemantics",
		"resolvedConfig",
		"resolvedLimits"
	], path);
	if (provenance.adapter !== "@3dena/analysis" || provenance.jenaPackage !== "jena-js") contractError$1(path, "contains an unsupported analysis adapter identity");
	nonEmptyString$2(provenance.adapterVersion, `${path}.adapterVersion`);
	for (const field of [
		"jenaVersion",
		"jenaCommit",
		"coreGoldenContract",
		"legacyGoldenContract",
		"parityContract",
		"resultSemantics"
	]) nonEmptyString$2(provenance[field], `${path}.${field}`);
	if (provenance.legacyGoldenStatus !== "not-assessed") contractError$1(`${path}.legacyGoldenStatus`, "must remain not-assessed in the scientific DTO");
	const config = objectAt$1(provenance.resolvedConfig, `${path}.resolvedConfig`);
	exactFields$2(config, [
		"model",
		"window",
		"weightBy",
		"windowSizeBack",
		"windowSizeForward",
		"centerAlignToOrigin"
	], `${path}.resolvedConfig`);
	if (!(config.model === "EndPoint" || config.model === "AccumulatedTrajectory" || config.model === "SeparateTrajectory")) contractError$1(`${path}.resolvedConfig.model`, "is unsupported");
	if (!(config.window === "MovingStanzaWindow" || config.window === "Conversation")) contractError$1(`${path}.resolvedConfig.window`, "is unsupported");
	if (config.weightBy !== "binary" && config.weightBy !== "sum") contractError$1(`${path}.resolvedConfig.weightBy`, "is unsupported");
	if (config.windowSizeBack === "Infinity") {
		if (config.window !== "Conversation") contractError$1(`${path}.resolvedConfig.windowSizeBack`, "may be Infinity only for Conversation windows");
	} else nonNegativeInteger(config.windowSizeBack, `${path}.resolvedConfig.windowSizeBack`);
	nonNegativeInteger(config.windowSizeForward, `${path}.resolvedConfig.windowSizeForward`);
	if (typeof config.centerAlignToOrigin !== "boolean") contractError$1(`${path}.resolvedConfig.centerAlignToOrigin`, "must be boolean");
	const limits = objectAt$1(provenance.resolvedLimits, `${path}.resolvedLimits`);
	exactFields$2(limits, [
		"maxRows",
		"maxColumns",
		"maxCells",
		"maxAccumulationCells",
		"maxCodes",
		"maxEdges",
		"maxStringLength",
		"maxUnits",
		"maxGroups",
		"maxTimePoints",
		"maxOutputPoints",
		"maxDimensions",
		"maxCoordinateCells"
	], `${path}.resolvedLimits`);
	for (const field of Object.keys(limits)) positiveInteger(limits[field], `${path}.resolvedLimits.${field}`);
}
function assertNetworkMean(value, dimensions, path) {
	const mean = objectAt$1(value, path);
	exactFields$2(mean, [
		"pointCount",
		"pointIndexes",
		"meanCoordinates",
		"edges"
	], path);
	const pointCount = positiveInteger(mean.pointCount, `${path}.pointCount`);
	if (!Array.isArray(mean.pointIndexes) || mean.pointIndexes.length !== pointCount) contractError$1(`${path}.pointIndexes`, "must align with pointCount");
	mean.pointIndexes.forEach((entry, index) => nonNegativeInteger(entry, `${path}.pointIndexes[${index}]`));
	finiteVector(mean.meanCoordinates, `${path}.meanCoordinates`, dimensions);
	if (!Array.isArray(mean.edges) || mean.edges.length === 0) contractError$1(`${path}.edges`, "must be a non-empty array");
	const edgeColumns = [];
	mean.edges.forEach((candidate, index) => {
		const edge = objectAt$1(candidate, `${path}.edges[${index}]`);
		exactFields$2(edge, [
			"index",
			"id",
			"column",
			"source",
			"target",
			"meanWeight"
		], `${path}.edges[${index}]`);
		if (nonNegativeInteger(edge.index, `${path}.edges[${index}].index`) !== index) contractError$1(`${path}.edges[${index}].index`, "must equal its array position");
		nonEmptyString$2(edge.id, `${path}.edges[${index}].id`);
		edgeColumns.push(nonEmptyString$2(edge.column, `${path}.edges[${index}].column`));
		nonEmptyString$2(edge.source, `${path}.edges[${index}].source`);
		nonEmptyString$2(edge.target, `${path}.edges[${index}].target`);
		finiteNumber(edge.meanWeight, `${path}.edges[${index}].meanWeight`);
	});
	return { edgeColumns };
}
function assertNetworkComparison(value, path) {
	const result = objectAt$1(value, path);
	exactFields$2(result, [
		"schemaVersion",
		"direction",
		"groupA",
		"groupB",
		"meanA",
		"meanB",
		"differenceEdges",
		"diagnostics"
	], path);
	if (result.schemaVersion !== "3dena.network-comparison.v1" || result.direction !== "group-a-minus-group-b") contractError$1(path, "contains an unsupported network-comparison contract");
	if (assertRawTypedValue(result.groupA, `${path}.groupA`).canonical === assertRawTypedValue(result.groupB, `${path}.groupB`).canonical) contractError$1(path, "groupA and groupB must differ");
	const meanA = objectAt$1(result.meanA, `${path}.meanA`);
	if (!Array.isArray(meanA.meanCoordinates)) contractError$1(`${path}.meanA.meanCoordinates`, "must be an array");
	const dimensions = meanA.meanCoordinates.length;
	if (dimensions < 1) contractError$1(`${path}.meanA.meanCoordinates`, "must not be empty");
	const a = assertNetworkMean(result.meanA, dimensions, `${path}.meanA`);
	sameOrderedStrings(assertNetworkMean(result.meanB, dimensions, `${path}.meanB`).edgeColumns, a.edgeColumns, `${path}.meanB.edges`);
	if (!Array.isArray(result.differenceEdges) || result.differenceEdges.length !== a.edgeColumns.length) contractError$1(`${path}.differenceEdges`, "must align with the group mean edges");
	result.differenceEdges.forEach((candidate, index) => {
		const edge = objectAt$1(candidate, `${path}.differenceEdges[${index}]`);
		exactFields$2(edge, [
			"index",
			"id",
			"column",
			"source",
			"target",
			"meanWeight",
			"groupAMeanWeight",
			"groupBMeanWeight",
			"semanticOwner"
		], `${path}.differenceEdges[${index}]`);
		if (nonNegativeInteger(edge.index, `${path}.differenceEdges[${index}].index`) !== index || edge.column !== a.edgeColumns[index]) contractError$1(`${path}.differenceEdges[${index}]`, "must preserve edge order");
		for (const field of [
			"id",
			"column",
			"source",
			"target"
		]) nonEmptyString$2(edge[field], `${path}.differenceEdges[${index}].${field}`);
		const difference = finiteNumber(edge.meanWeight, `${path}.differenceEdges[${index}].meanWeight`);
		const groupAMean = finiteNumber(edge.groupAMeanWeight, `${path}.differenceEdges[${index}].groupAMeanWeight`);
		const groupBMean = finiteNumber(edge.groupBMeanWeight, `${path}.differenceEdges[${index}].groupBMeanWeight`);
		if (Math.abs(difference - (groupAMean - groupBMean)) > Number.EPSILON * Math.max(1, Math.abs(difference), Math.abs(groupAMean), Math.abs(groupBMean)) * 8) contractError$1(`${path}.differenceEdges[${index}].meanWeight`, "must equal group A mean minus group B mean");
		const owner = difference > 0 ? "group-a" : difference < 0 ? "group-b" : "equal";
		if (edge.semanticOwner !== owner) contractError$1(`${path}.differenceEdges[${index}].semanticOwner`, "does not match the signed difference");
	});
	assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
}
function assertChangeNetwork(value, path) {
	const result = objectAt$1(value, path);
	exactFields$2(result, [
		"schemaVersion",
		"selector",
		"levelCanonical",
		"mean",
		"diagnostics"
	], path);
	if (result.schemaVersion !== "3dena.change-network.v1") contractError$1(`${path}.schemaVersion`, "must be 3dena.change-network.v1");
	const selector = objectAt$1(result.selector, `${path}.selector`);
	exactFields$2(selector, ["field", "level"], `${path}.selector`);
	nonEmptyString$2(selector.field, `${path}.selector.field`);
	rawScalar(selector.level, `${path}.selector.level`);
	nonEmptyString$2(result.levelCanonical, `${path}.levelCanonical`);
	const mean = objectAt$1(result.mean, `${path}.mean`);
	if (!Array.isArray(mean.meanCoordinates) || mean.meanCoordinates.length < 1) contractError$1(`${path}.mean.meanCoordinates`, "must be a non-empty array");
	assertNetworkMean(result.mean, mean.meanCoordinates.length, `${path}.mean`);
	assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
}
function assertStatsContract(value, path) {
	const contract = objectAt$1(value, path);
	const expected = {
		schemaVersion: "3dena.stats.contract.v1",
		direction: "A-minus-B",
		missing: "drop-explicit-null",
		ties: "exact-value-midrank",
		signedRankZeros: "drop-exact-zero",
		rankInference: "asymptotic-normal",
		continuityCorrection: true,
		independentCohenD: "pooled-sample-standard-deviation",
		pairedCohenD: "mean-paired-difference-over-sample-sd",
		meanDifferenceConfidenceInterval: "alternative-aligned-t-interval-95-percent",
		pValueAdjustmentFamily: "caller-supplied-complete-family"
	};
	exactFields$2(contract, Object.keys(expected), path);
	for (const [field, expectedValue] of Object.entries(expected)) if (contract[field] !== expectedValue) contractError$1(`${path}.${field}`, `must be ${JSON.stringify(expectedValue)}`);
}
function probability(value, path) {
	const number = finiteNumber(value, path);
	if (number < 0 || number > 1) contractError$1(path, "must be in [0, 1]");
	return number;
}
function assertConfidenceBound(value, path) {
	const bound = objectAt$1(value, path);
	const kind = nonEmptyString$2(bound.kind, `${path}.kind`);
	if (kind === "finite") {
		exactFields$2(bound, ["kind", "value"], path);
		finiteNumber(bound.value, `${path}.value`);
	} else if ([
		"negative-infinity",
		"positive-infinity",
		"undefined",
		"unrepresentable"
	].includes(kind)) exactFields$2(bound, ["kind"], path);
	else contractError$1(`${path}.kind`, "is unsupported");
}
function assertConfidenceInterval(value, path) {
	const interval = objectAt$1(value, path);
	exactFields$2(interval, [
		"method",
		"confidenceLevel",
		"alternative",
		"lower",
		"upper"
	], path);
	if (interval.method !== "welch-t-mean-difference-v1" && interval.method !== "paired-t-mean-difference-v1") contractError$1(`${path}.method`, "is unsupported");
	if (interval.confidenceLevel !== .95) contractError$1(`${path}.confidenceLevel`, "must be 0.95");
	if (![
		"two-sided",
		"greater",
		"less"
	].includes(interval.alternative)) contractError$1(`${path}.alternative`, "is unsupported");
	assertConfidenceBound(interval.lower, `${path}.lower`);
	assertConfidenceBound(interval.upper, `${path}.upper`);
}
function assertAdjustment(value, path) {
	const adjustment = objectAt$1(value, path);
	exactFields$2(adjustment, [
		"method",
		"raw",
		"adjusted"
	], path);
	if (![
		"none",
		"holm",
		"bh",
		"bonferroni"
	].includes(adjustment.method)) contractError$1(`${path}.method`, "is unsupported");
	if (!Array.isArray(adjustment.raw) || !Array.isArray(adjustment.adjusted) || adjustment.raw.length !== adjustment.adjusted.length || adjustment.raw.length === 0) contractError$1(path, "raw and adjusted p-value families must be non-empty and aligned");
	adjustment.raw.forEach((entry, index) => probability(entry, `${path}.raw[${index}]`));
	adjustment.adjusted.forEach((entry, index) => probability(entry, `${path}.adjusted[${index}]`));
}
function assertStatsResult(value, expectedDesign, path) {
	const result = objectAt$1(value, path);
	if (expectedDesign === "independent") {
		exactFields$2(result, [
			"schemaVersion",
			"design",
			"direction",
			"contract",
			"alternative",
			"samples",
			"estimates",
			"welch",
			"mannWhitney",
			"effects",
			"adjustment",
			"diagnostics"
		], path);
		if (result.schemaVersion !== "3dena.stats.independent-result.v1" || result.design !== "independent") contractError$1(path, "must be an independent statistics result");
		const samples = objectAt$1(result.samples, `${path}.samples`);
		exactFields$2(samples, ["sideA", "sideB"], `${path}.samples`);
		for (const side of ["sideA", "sideB"]) {
			const sample = objectAt$1(samples[side], `${path}.samples.${side}`);
			exactFields$2(sample, [
				"label",
				"input",
				"valid",
				"droppedMissing"
			], `${path}.samples.${side}`);
			nonEmptyString$2(sample.label, `${path}.samples.${side}.label`);
			const input = positiveInteger(sample.input, `${path}.samples.${side}.input`);
			if (positiveInteger(sample.valid, `${path}.samples.${side}.valid`) + nonNegativeInteger(sample.droppedMissing, `${path}.samples.${side}.droppedMissing`) !== input) contractError$1(`${path}.samples.${side}`, "valid plus droppedMissing must equal input");
		}
		const estimates = objectAt$1(result.estimates, `${path}.estimates`);
		exactFields$2(estimates, [
			"meanA",
			"meanB",
			"meanDifference",
			"confidenceInterval"
		], `${path}.estimates`);
		finiteNumber(estimates.meanA, `${path}.estimates.meanA`);
		finiteNumber(estimates.meanB, `${path}.estimates.meanB`);
		finiteOrNull(estimates.meanDifference, `${path}.estimates.meanDifference`);
		assertConfidenceInterval(estimates.confidenceInterval, `${path}.estimates.confidenceInterval`);
		const welch = objectAt$1(result.welch, `${path}.welch`);
		exactFields$2(welch, [
			"method",
			"alternative",
			"statistic",
			"degreesOfFreedom",
			"pValue"
		], `${path}.welch`);
		if (welch.method !== "welch-t-v1") contractError$1(`${path}.welch.method`, "must be welch-t-v1");
		finiteOrNull(welch.statistic, `${path}.welch.statistic`);
		finiteOrNull(welch.degreesOfFreedom, `${path}.welch.degreesOfFreedom`);
		probability(welch.pValue, `${path}.welch.pValue`);
		const mann = objectAt$1(result.mannWhitney, `${path}.mannWhitney`);
		exactFields$2(mann, [
			"method",
			"alternative",
			"tiePolicy",
			"continuityCorrection",
			"uA",
			"uB",
			"z",
			"pValue",
			"tieGroups",
			"tiedObservations"
		], `${path}.mannWhitney`);
		if (mann.method !== "mann-whitney-asymptotic-v1" || mann.tiePolicy !== "exact-value-midrank" || mann.continuityCorrection !== true) contractError$1(`${path}.mannWhitney`, "contains unsupported rank-test semantics");
		for (const field of [
			"uA",
			"uB",
			"z"
		]) finiteNumber(mann[field], `${path}.mannWhitney.${field}`);
		probability(mann.pValue, `${path}.mannWhitney.pValue`);
		nonNegativeInteger(mann.tieGroups, `${path}.mannWhitney.tieGroups`);
		nonNegativeInteger(mann.tiedObservations, `${path}.mannWhitney.tiedObservations`);
	} else {
		exactFields$2(result, [
			"schemaVersion",
			"design",
			"direction",
			"contract",
			"alternative",
			"matching",
			"estimates",
			"wilcoxonSignedRank",
			"effects",
			"adjustment",
			"diagnostics"
		], path);
		if (result.schemaVersion !== "3dena.stats.paired-result.v1" || result.design !== "paired") contractError$1(path, "must be a paired statistics result");
		const matching = objectAt$1(result.matching, `${path}.matching`);
		exactFields$2(matching, [
			"sideAInput",
			"sideBInput",
			"matched",
			"validPairs",
			"droppedMissingPairs",
			"unmatchedA",
			"unmatchedB",
			"zeroDifferences",
			"rankedPairs"
		], `${path}.matching`);
		for (const field of Object.keys(matching)) nonNegativeInteger(matching[field], `${path}.matching.${field}`);
		if (matching.matched !== matching.validPairs + matching.droppedMissingPairs || matching.rankedPairs !== matching.validPairs - matching.zeroDifferences) contractError$1(`${path}.matching`, "pair counts are inconsistent");
		const estimates = objectAt$1(result.estimates, `${path}.estimates`);
		exactFields$2(estimates, ["meanDifference", "confidenceInterval"], `${path}.estimates`);
		finiteOrNull(estimates.meanDifference, `${path}.estimates.meanDifference`);
		assertConfidenceInterval(estimates.confidenceInterval, `${path}.estimates.confidenceInterval`);
		const signed = objectAt$1(result.wilcoxonSignedRank, `${path}.wilcoxonSignedRank`);
		exactFields$2(signed, [
			"method",
			"alternative",
			"tiePolicy",
			"zeroPolicy",
			"continuityCorrection",
			"statistic",
			"wPositive",
			"wNegative",
			"z",
			"pValue",
			"tieGroups",
			"tiedObservations"
		], `${path}.wilcoxonSignedRank`);
		if (signed.method !== "wilcoxon-signed-rank-asymptotic-v1" || signed.tiePolicy !== "exact-absolute-difference-midrank" || signed.zeroPolicy !== "drop-exact-zero" || signed.continuityCorrection !== true) contractError$1(`${path}.wilcoxonSignedRank`, "contains unsupported signed-rank semantics");
		for (const field of [
			"statistic",
			"wPositive",
			"wNegative",
			"z"
		]) finiteNumber(signed[field], `${path}.wilcoxonSignedRank.${field}`);
		probability(signed.pValue, `${path}.wilcoxonSignedRank.pValue`);
		nonNegativeInteger(signed.tieGroups, `${path}.wilcoxonSignedRank.tieGroups`);
		nonNegativeInteger(signed.tiedObservations, `${path}.wilcoxonSignedRank.tiedObservations`);
	}
	if (result.direction !== "A-minus-B") contractError$1(`${path}.direction`, "must be A-minus-B");
	if (![
		"two-sided",
		"greater",
		"less"
	].includes(result.alternative)) contractError$1(`${path}.alternative`, "is unsupported");
	assertStatsContract(result.contract, `${path}.contract`);
	const effects = objectAt$1(result.effects, `${path}.effects`);
	exactFields$2(effects, ["cohensD", "rankBiserial"], `${path}.effects`);
	finiteOrNull(effects.cohensD, `${path}.effects.cohensD`);
	finiteNumber(effects.rankBiserial, `${path}.effects.rankBiserial`);
	assertAdjustment(result.adjustment, `${path}.adjustment`);
	assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
}
function assertStatisticsTaskResult(value, path) {
	const result = objectAt$1(value, path);
	exactFields$2(result, [
		"schemaVersion",
		"design",
		"direction",
		"groups",
		"dimensions"
	], path);
	if (result.schemaVersion !== "3dena.statistics-task-result.v1") contractError$1(`${path}.schemaVersion`, "must be 3dena.statistics-task-result.v1");
	if (result.design !== "independent" && result.design !== "paired") contractError$1(`${path}.design`, "must be independent or paired");
	if (result.direction !== "group-a-minus-group-b") contractError$1(`${path}.direction`, "must be group-a-minus-group-b");
	stringPair(result.groups, `${path}.groups`);
	if (!Array.isArray(result.dimensions) || result.dimensions.length === 0) contractError$1(`${path}.dimensions`, "must be non-empty");
	const seen = /* @__PURE__ */ new Set();
	result.dimensions.forEach((candidate, index) => {
		const dimension = objectAt$1(candidate, `${path}.dimensions[${index}]`);
		exactFields$2(dimension, ["dimension", "result"], `${path}.dimensions[${index}]`);
		const name = nonEmptyString$2(dimension.dimension, `${path}.dimensions[${index}].dimension`);
		if (seen.has(name)) contractError$1(`${path}.dimensions[${index}].dimension`, "duplicates an earlier dimension");
		seen.add(name);
		assertStatsResult(dimension.result, result.design, `${path}.dimensions[${index}].result`);
	});
}
function assertTrajectoryIdentity(value, path, key) {
	const identity = objectAt$1(value, path);
	allowedFields(identity, key ? [
		"components",
		"canonical",
		"display"
	] : ["components"], key ? [
		"components",
		"canonical",
		"display"
	] : ["components"], path);
	if (!Array.isArray(identity.components) || identity.components.length === 0) contractError$1(`${path}.components`, "must be non-empty");
	const names = /* @__PURE__ */ new Set();
	identity.components.forEach((candidate, index) => {
		const component = objectAt$1(candidate, `${path}.components[${index}]`);
		allowedFields(component, [
			"name",
			"type",
			"value",
			"declaredType"
		], [
			"name",
			"type",
			"value"
		], `${path}.components[${index}]`);
		const name = nonEmptyString$2(component.name, `${path}.components[${index}].name`);
		if (names.has(name)) contractError$1(`${path}.components[${index}].name`, "duplicates an earlier component");
		names.add(name);
		if (![
			"string",
			"number",
			"boolean"
		].includes(component.type)) contractError$1(`${path}.components[${index}].type`, "is unsupported");
		if (component.type === "string" && (typeof component.value !== "string" || component.value.length === 0)) contractError$1(`${path}.components[${index}].value`, "must be a non-empty string");
		if (component.type === "boolean" && typeof component.value !== "boolean") contractError$1(`${path}.components[${index}].value`, "must be boolean");
		if (component.type === "number") rawScalar(component.value, `${path}.components[${index}].value`);
		if (component.declaredType !== void 0) nonEmptyString$2(component.declaredType, `${path}.components[${index}].declaredType`);
	});
	if (!key) return null;
	nonEmptyString$2(identity.display, `${path}.display`);
	return nonEmptyString$2(identity.canonical, `${path}.canonical`);
}
function assertDistanceMetrics(value, dimensions, path, includeSpeed) {
	const metrics = objectAt$1(value, path);
	exactFields$2(metrics, includeSpeed ? [
		"dimensions",
		"delta",
		"stepDistance",
		"cumulativeDistance",
		"speed"
	] : [
		"dimensions",
		"delta",
		"stepDistance",
		"cumulativeDistance"
	], path);
	sameOrderedStrings(stringList$1(metrics.dimensions, `${path}.dimensions`), dimensions, `${path}.dimensions`);
	if (metrics.delta !== null) finiteVector(metrics.delta, `${path}.delta`, dimensions.length);
	finiteOrNull(metrics.stepDistance, `${path}.stepDistance`);
	finiteOrNull(metrics.cumulativeDistance, `${path}.cumulativeDistance`);
	if (includeSpeed) finiteOrNull(metrics.speed, `${path}.speed`);
}
function assertTrajectoryPathStatistics(value, path) {
	const result = objectAt$1(value, path);
	exactFields$2(result, [
		"schemaVersion",
		"namespace",
		"cohortPolicy",
		"estimand",
		"dimensions",
		"selectedDimensions",
		"distanceSemantics",
		"participantPeriods",
		"periods",
		"diagnostics",
		"summary",
		"resolvedLimits"
	], path);
	if (result.schemaVersion !== "3dena.trajectory-path-statistics.v1") contractError$1(`${path}.schemaVersion`, "must be 3dena.trajectory-path-statistics.v1");
	nonEmptyString$2(result.namespace, `${path}.namespace`);
	if (result.cohortPolicy !== "available" && result.cohortPolicy !== "complete") contractError$1(`${path}.cohortPolicy`, "is unsupported");
	if (result.estimand !== "equal-participant" && result.estimand !== "weighted-participant") contractError$1(`${path}.estimand`, "is unsupported");
	const dimensions = stringList$1(result.dimensions, `${path}.dimensions`);
	const selected = stringList$1(result.selectedDimensions, `${path}.selectedDimensions`, 3);
	if (selected.length !== 3 || selected.some((entry) => !dimensions.includes(entry))) contractError$1(`${path}.selectedDimensions`, "must contain three declared dimensions");
	const semantics = objectAt$1(result.distanceSemantics, `${path}.distanceSemantics`);
	exactFields$2(semantics, ["selected3d", "fullSpace"], `${path}.distanceSemantics`);
	if (semantics.selected3d !== "euclidean-selected-three-dimensions" || semantics.fullSpace !== "euclidean-all-declared-dimensions") contractError$1(`${path}.distanceSemantics`, "is unsupported");
	assertTrajectoryParticipantPeriods(result.participantPeriods, dimensions, `${path}.participantPeriods`, true);
	if (!Array.isArray(result.periods)) contractError$1(`${path}.periods`, "must be an array");
	result.periods.forEach((candidate, index) => {
		const period = objectAt$1(candidate, `${path}.periods[${index}]`);
		exactFields$2(period, [
			"index",
			"time",
			"selectedCentroid",
			"fullCentroid",
			"selected3d",
			"fullSpace",
			"nRows",
			"nTotal",
			"nUsed",
			"nDuplicateRows",
			"nCohortExcluded"
		], `${path}.periods[${index}]`);
		if (nonNegativeInteger(period.index, `${path}.periods[${index}].index`) !== index) contractError$1(`${path}.periods[${index}].index`, "must equal its array position");
		assertTrajectoryIdentity(period.time, `${path}.periods[${index}].time`, true);
		optionalFiniteVector(period.selectedCentroid, `${path}.periods[${index}].selectedCentroid`, 3);
		optionalFiniteVector(period.fullCentroid, `${path}.periods[${index}].fullCentroid`, dimensions.length);
		assertDistanceMetrics(period.selected3d, selected, `${path}.periods[${index}].selected3d`, false);
		assertDistanceMetrics(period.fullSpace, dimensions, `${path}.periods[${index}].fullSpace`, false);
		for (const field of [
			"nRows",
			"nTotal",
			"nUsed",
			"nDuplicateRows",
			"nCohortExcluded"
		]) nonNegativeInteger(period[field], `${path}.periods[${index}].${field}`);
	});
	assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
	assertTrajectorySummary(result.summary, `${path}.summary`, false);
	assertLimits(result.resolvedLimits, [
		"maxPoints",
		"maxDimensions",
		"maxPeriods",
		"maxParticipants",
		"maxCells",
		"maxResamples",
		"maxTests"
	], `${path}.resolvedLimits`);
}
function assertTrajectoryParticipantPeriods(value, dimensions, path, weighted) {
	if (!Array.isArray(value)) contractError$1(path, "must be an array");
	value.forEach((candidate, index) => {
		const row = objectAt$1(candidate, `${path}[${index}]`);
		exactFields$2(row, weighted ? [
			"index",
			"participant",
			"time",
			"selectedCoordinates",
			"fullCoordinates",
			"sourceRowIndexes",
			"participantWeight",
			"includedInCohort"
		] : [
			"index",
			"participant",
			"time",
			"selectedCoordinates",
			"fullCoordinates",
			"sourceRowIndexes",
			"includedInCohort"
		], `${path}[${index}]`);
		if (nonNegativeInteger(row.index, `${path}[${index}].index`) !== index) contractError$1(`${path}[${index}].index`, "must equal its array position");
		assertTrajectoryIdentity(row.participant, `${path}[${index}].participant`, true);
		assertTrajectoryIdentity(row.time, `${path}[${index}].time`, true);
		finiteVector(row.selectedCoordinates, `${path}[${index}].selectedCoordinates`, 3);
		finiteVector(row.fullCoordinates, `${path}[${index}].fullCoordinates`, dimensions.length);
		if (!Array.isArray(row.sourceRowIndexes) || row.sourceRowIndexes.length === 0) contractError$1(`${path}[${index}].sourceRowIndexes`, "must be non-empty");
		row.sourceRowIndexes.forEach((entry, itemIndex) => nonNegativeInteger(entry, `${path}[${index}].sourceRowIndexes[${itemIndex}]`));
		if (weighted && finiteNumber(row.participantWeight, `${path}[${index}].participantWeight`) <= 0) contractError$1(`${path}[${index}].participantWeight`, "must be positive");
		if (typeof row.includedInCohort !== "boolean") contractError$1(`${path}[${index}].includedInCohort`, "must be boolean");
	});
}
function assertTrajectorySummary(value, path, dynamics) {
	const summary = objectAt$1(value, path);
	const fields = dynamics ? [
		"inputRows",
		"participants",
		"participantPeriods",
		"periods",
		"observedPeriods",
		"missingPeriods",
		"duplicateRows",
		"cohortExcludedParticipants"
	] : [
		"inputRows",
		"participants",
		"participantPeriods",
		"periods",
		"duplicateRows"
	];
	exactFields$2(summary, fields, path);
	for (const field of fields) nonNegativeInteger(summary[field], `${path}.${field}`);
	if (dynamics && summary.periods !== summary.observedPeriods + summary.missingPeriods) contractError$1(path, "observed and missing period counts must sum to periods");
}
function assertLimits(value, fields, path) {
	const limits = objectAt$1(value, path);
	exactFields$2(limits, fields, path);
	for (const field of fields) positiveInteger(limits[field], `${path}.${field}`);
}
function assertTrajectoryDynamics(value, path) {
	const result = objectAt$1(value, path);
	exactFields$2(result, [
		"schemaVersion",
		"namespace",
		"cohortPolicy",
		"estimand",
		"dimensions",
		"selectedDimensions",
		"timeContract",
		"contracts",
		"participantPeriods",
		"periods",
		"diagnostics",
		"diagnosticSummary",
		"summary",
		"evidence",
		"resolvedLimits"
	], path);
	if (result.schemaVersion !== "3dena.trajectory-dynamics.v1") contractError$1(`${path}.schemaVersion`, "must be 3dena.trajectory-dynamics.v1");
	nonEmptyString$2(result.namespace, `${path}.namespace`);
	if (result.cohortPolicy !== "available" && result.cohortPolicy !== "complete") contractError$1(`${path}.cohortPolicy`, "is unsupported");
	const estimand = objectAt$1(result.estimand, `${path}.estimand`);
	exactFields$2(estimand, ["kind"], `${path}.estimand`);
	if (estimand.kind !== "equal-participant-v1" && estimand.kind !== "weighted-participant-v1") contractError$1(`${path}.estimand.kind`, "is unsupported");
	const dimensions = stringList$1(result.dimensions, `${path}.dimensions`);
	const selected = stringList$1(result.selectedDimensions, `${path}.selectedDimensions`, 3);
	if (selected.length !== 3 || selected.some((entry) => !dimensions.includes(entry))) contractError$1(`${path}.selectedDimensions`, "must contain three declared dimensions");
	assertTimeContract(result.timeContract, `${path}.timeContract`);
	const contracts = objectAt$1(result.contracts, `${path}.contracts`);
	const expectedContracts = {
		duplicateReduction: "equal-row-coordinate-mean-before-centroid-v1",
		weightResolution: "constant-within-participant-period-v1",
		cohort: "available-or-complete-before-centroid-v1",
		distance: "euclidean-selected-and-full-space-v1",
		gap: "expected-period-no-bridge-v1",
		speed: "step-distance-divided-by-positive-adjacent-elapsed-v1"
	};
	exactFields$2(contracts, Object.keys(expectedContracts), `${path}.contracts`);
	for (const [field, expected] of Object.entries(expectedContracts)) if (contracts[field] !== expected) contractError$1(`${path}.contracts.${field}`, `must be ${expected}`);
	assertTrajectoryParticipantPeriods(result.participantPeriods, dimensions, `${path}.participantPeriods`, true);
	if (!Array.isArray(result.periods)) contractError$1(`${path}.periods`, "must be an array");
	result.periods.forEach((candidate, index) => {
		const period = objectAt$1(candidate, `${path}.periods[${index}]`);
		exactFields$2(period, [
			"index",
			"time",
			"timeValue",
			"elapsedFromPrevious",
			"elapsedFromStart",
			"selectedCentroid",
			"fullCentroid",
			"selected3d",
			"fullSpace",
			"nRows",
			"nParticipantPeriods",
			"nUsed",
			"nDuplicateRows",
			"nCohortExcluded",
			"weightSum",
			"effectiveParticipantN"
		], `${path}.periods[${index}]`);
		if (nonNegativeInteger(period.index, `${path}.periods[${index}].index`) !== index) contractError$1(`${path}.periods[${index}].index`, "must equal its array position");
		assertTrajectoryIdentity(period.time, `${path}.periods[${index}].time`, true);
		assertTrajectoryTimeValue(period.timeValue, `${path}.periods[${index}].timeValue`);
		finiteOrNull(period.elapsedFromPrevious, `${path}.periods[${index}].elapsedFromPrevious`);
		finiteNumber(period.elapsedFromStart, `${path}.periods[${index}].elapsedFromStart`);
		optionalFiniteVector(period.selectedCentroid, `${path}.periods[${index}].selectedCentroid`, 3);
		optionalFiniteVector(period.fullCentroid, `${path}.periods[${index}].fullCentroid`, dimensions.length);
		assertDistanceMetrics(period.selected3d, selected, `${path}.periods[${index}].selected3d`, true);
		assertDistanceMetrics(period.fullSpace, dimensions, `${path}.periods[${index}].fullSpace`, true);
		for (const field of [
			"nRows",
			"nParticipantPeriods",
			"nUsed",
			"nDuplicateRows",
			"nCohortExcluded"
		]) nonNegativeInteger(period[field], `${path}.periods[${index}].${field}`);
		finiteOrNull(period.weightSum, `${path}.periods[${index}].weightSum`);
		finiteOrNull(period.effectiveParticipantN, `${path}.periods[${index}].effectiveParticipantN`);
	});
	assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
	const diagnosticSummary = objectAt$1(result.diagnosticSummary, `${path}.diagnosticSummary`);
	exactFields$2(diagnosticSummary, [
		"info",
		"warning",
		"codes"
	], `${path}.diagnosticSummary`);
	nonNegativeInteger(diagnosticSummary.info, `${path}.diagnosticSummary.info`);
	nonNegativeInteger(diagnosticSummary.warning, `${path}.diagnosticSummary.warning`);
	stringList$1(diagnosticSummary.codes, `${path}.diagnosticSummary.codes`, 0);
	assertTrajectorySummary(result.summary, `${path}.summary`, true);
	const evidence = objectAt$1(result.evidence, `${path}.evidence`);
	exactFields$2(evidence, [
		"status",
		"oracleParityClaim",
		"scientificAuthority"
	], `${path}.evidence`);
	if (evidence.status !== "IMPLEMENTED_UNVERIFIED" || evidence.oracleParityClaim !== false || evidence.scientificAuthority !== "successor-definition-pending-review") contractError$1(`${path}.evidence`, "must not claim unapproved scientific authority");
	assertLimits(result.resolvedLimits, [
		"maxPoints",
		"maxDimensions",
		"maxPeriods",
		"maxParticipants",
		"maxCells"
	], `${path}.resolvedLimits`);
}
function assertTimeContract(value, path) {
	const contract = objectAt$1(value, path);
	const kind = nonEmptyString$2(contract.kind, `${path}.kind`);
	if (kind === "numeric-v1") {
		exactFields$2(contract, [
			"kind",
			"elapsedUnit",
			"chronology"
		], path);
		nonEmptyString$2(contract.elapsedUnit, `${path}.elapsedUnit`);
		if (contract.chronology !== "strictly-increasing-finite-number-v1") contractError$1(`${path}.chronology`, "is unsupported");
	} else if (kind === "date-v1") {
		exactFields$2(contract, [
			"kind",
			"elapsedUnit",
			"calendar",
			"chronology"
		], path);
		if (contract.elapsedUnit !== "days" || contract.calendar !== "proleptic-gregorian-v1" || contract.chronology !== "strictly-increasing-civil-day-v1") contractError$1(path, "contains unsupported civil-date semantics");
	} else if (kind === "instant-v1") {
		exactFields$2(contract, [
			"kind",
			"elapsedUnit",
			"epoch",
			"chronology",
			"zoneRole"
		], path);
		trajectoryDurationUnit(contract.elapsedUnit, `${path}.elapsedUnit`);
		if (contract.epoch !== "unix-epoch-milliseconds-int64-v1" || contract.chronology !== "strictly-increasing-exact-epoch-v1" || contract.zoneRole !== "presentation-provenance-only") contractError$1(path, "contains unsupported instant semantics");
	} else if (kind === "difftime-v1") {
		exactFields$2(contract, [
			"kind",
			"elapsedUnit",
			"conversion",
			"chronology"
		], path);
		trajectoryDurationUnit(contract.elapsedUnit, `${path}.elapsedUnit`);
		if (contract.conversion !== "fixed-duration-unit-ratios-v1" || contract.chronology !== "strictly-increasing-normalized-duration-v1") contractError$1(path, "contains unsupported duration semantics");
	} else contractError$1(`${path}.kind`, "is unsupported");
}
function assertTrajectoryComparison(value, path) {
	const result = objectAt$1(value, path);
	exactFields$2(result, [
		"schemaVersion",
		"design",
		"direction",
		"pairedId",
		"sideA",
		"sideB",
		"periods",
		"tests",
		"permutation",
		"diagnostics"
	], path);
	if (result.schemaVersion !== "3dena.trajectory-comparison.v1" || result.design !== "paired" && result.design !== "independent" || result.direction !== "B-minus-A") contractError$1(path, "contains an unsupported trajectory-comparison contract");
	if (result.design === "paired") {
		if (typeof result.pairedId !== "string" && (!Array.isArray(result.pairedId) || result.pairedId.length === 0)) contractError$1(`${path}.pairedId`, "must declare the exact paired identity");
	} else if (result.pairedId !== null) contractError$1(`${path}.pairedId`, "must be null for independent comparison");
	assertTrajectoryPathStatistics(result.sideA, `${path}.sideA`);
	assertTrajectoryPathStatistics(result.sideB, `${path}.sideB`);
	const sideA = result.sideA;
	const sideB = result.sideB;
	sameOrderedStrings(sideB.dimensions, sideA.dimensions, `${path}.sideB.dimensions`);
	if (!Array.isArray(result.periods) || result.periods.length !== sideA.periods.length || result.periods.length !== sideB.periods.length) contractError$1(`${path}.periods`, "must align one-to-one with both paths");
	const periods = result.periods;
	periods.forEach((candidate, index) => assertTrajectoryComparisonPeriod(candidate, sideA.dimensions.length, index, `${path}.periods[${index}]`));
	if (!Array.isArray(result.tests)) contractError$1(`${path}.tests`, "must be an array");
	result.tests.forEach((candidate, index) => {
		const test = objectAt$1(candidate, `${path}.tests[${index}]`);
		exactFields$2(test, [
			"id",
			"timeIndex",
			"metric",
			"distanceSpace",
			"tail",
			"observed",
			"pValue",
			"holmAdjustedPValue",
			"permutationCount"
		], `${path}.tests[${index}]`);
		nonEmptyString$2(test.id, `${path}.tests[${index}].id`);
		if (nonNegativeInteger(test.timeIndex, `${path}.tests[${index}].timeIndex`) >= periods.length) contractError$1(`${path}.tests[${index}].timeIndex`, "is outside the period table");
		nonEmptyString$2(test.metric, `${path}.tests[${index}].metric`);
		if (test.distanceSpace !== null && test.distanceSpace !== "selected-3d" && test.distanceSpace !== "full-space") contractError$1(`${path}.tests[${index}].distanceSpace`, "is unsupported");
		if (test.tail !== "two-sided" && test.tail !== "upper") contractError$1(`${path}.tests[${index}].tail`, "is unsupported");
		finiteNumber(test.observed, `${path}.tests[${index}].observed`);
		probability(test.pValue, `${path}.tests[${index}].pValue`);
		probability(test.holmAdjustedPValue, `${path}.tests[${index}].holmAdjustedPValue`);
		positiveInteger(test.permutationCount, `${path}.tests[${index}].permutationCount`);
	});
	const permutation = objectAt$1(result.permutation, `${path}.permutation`);
	exactFields$2(permutation, [
		"status",
		"planKind",
		"unitOrder",
		"replicateCount",
		"rngParityClaim"
	], `${path}.permutation`);
	if (permutation.status !== "not-requested" && permutation.status !== "complete") contractError$1(`${path}.permutation.status`, "is unsupported");
	if (permutation.planKind !== null && permutation.planKind !== "paired-swap-indices-v1" && permutation.planKind !== "independent-pool-indices-v1") contractError$1(`${path}.permutation.planKind`, "is unsupported");
	stringList$1(permutation.unitOrder, `${path}.permutation.unitOrder`, 0);
	nonNegativeInteger(permutation.replicateCount, `${path}.permutation.replicateCount`);
	if (permutation.rngParityClaim !== false) contractError$1(`${path}.permutation.rngParityClaim`, "must remain false until independently approved");
	assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
}
function assertTrajectoryComparisonPeriod(value, dimensions, index, path) {
	const period = objectAt$1(value, path);
	exactFields$2(period, [
		"index",
		"time",
		"selectedCentroidA",
		"selectedCentroidB",
		"selectedDifference",
		"fullCentroidA",
		"fullCentroidB",
		"fullDifference",
		"selectedCentroidSeparation",
		"fullCentroidSeparation",
		"selectedStepDistanceA",
		"selectedStepDistanceB",
		"selectedStepDistanceDifference",
		"selectedCumulativeDistanceA",
		"selectedCumulativeDistanceB",
		"selectedCumulativeDistanceDifference",
		"fullStepDistanceA",
		"fullStepDistanceB",
		"fullStepDistanceDifference",
		"fullCumulativeDistanceA",
		"fullCumulativeDistanceB",
		"fullCumulativeDistanceDifference",
		"nAUsed",
		"nBUsed",
		"nMatched"
	], path);
	if (nonNegativeInteger(period.index, `${path}.index`) !== index) contractError$1(`${path}.index`, "must equal its array position");
	assertTrajectoryIdentity(period.time, `${path}.time`, true);
	for (const field of [
		"selectedCentroidA",
		"selectedCentroidB",
		"selectedDifference"
	]) optionalFiniteVector(period[field], `${path}.${field}`, 3);
	for (const field of [
		"fullCentroidA",
		"fullCentroidB",
		"fullDifference"
	]) optionalFiniteVector(period[field], `${path}.${field}`, dimensions);
	for (const field of [
		"selectedCentroidSeparation",
		"fullCentroidSeparation",
		"selectedStepDistanceA",
		"selectedStepDistanceB",
		"selectedStepDistanceDifference",
		"selectedCumulativeDistanceA",
		"selectedCumulativeDistanceB",
		"selectedCumulativeDistanceDifference",
		"fullStepDistanceA",
		"fullStepDistanceB",
		"fullStepDistanceDifference",
		"fullCumulativeDistanceA",
		"fullCumulativeDistanceB",
		"fullCumulativeDistanceDifference"
	]) finiteOrNull(period[field], `${path}.${field}`);
	nonNegativeInteger(period.nAUsed, `${path}.nAUsed`);
	nonNegativeInteger(period.nBUsed, `${path}.nBUsed`);
	if (period.nMatched !== null) nonNegativeInteger(period.nMatched, `${path}.nMatched`);
}
function assertBootstrapInterval(value, path) {
	const interval = objectAt$1(value, path);
	exactFields$2(interval, [
		"estimate",
		"lower",
		"upper",
		"finiteReplicates",
		"requiredFiniteReplicates",
		"totalReplicates"
	], path);
	finiteNumber(interval.estimate, `${path}.estimate`);
	finiteNumber(interval.lower, `${path}.lower`);
	finiteNumber(interval.upper, `${path}.upper`);
	if (interval.lower > interval.upper) contractError$1(path, "lower must not exceed upper");
	const finite = nonNegativeInteger(interval.finiteReplicates, `${path}.finiteReplicates`);
	const required = positiveInteger(interval.requiredFiniteReplicates, `${path}.requiredFiniteReplicates`);
	const total = positiveInteger(interval.totalReplicates, `${path}.totalReplicates`);
	if (finite > total || required > total) contractError$1(path, "replicate counts are inconsistent");
}
function assertBootstrap(value, path) {
	const result = objectAt$1(value, path);
	exactFields$2(result, [
		"schemaVersion",
		"base",
		"confidenceLevel",
		"periods",
		"quantileRule",
		"resampling",
		"diagnostics"
	], path);
	if (result.schemaVersion !== "3dena.trajectory-bootstrap.v1") contractError$1(`${path}.schemaVersion`, "must be 3dena.trajectory-bootstrap.v1");
	assertTrajectoryPathStatistics(result.base, `${path}.base`);
	probability(result.confidenceLevel, `${path}.confidenceLevel`);
	const base = result.base;
	if (!Array.isArray(result.periods) || result.periods.length !== base.periods.length) contractError$1(`${path}.periods`, "must align one-to-one with the base path");
	result.periods.forEach((candidate, index) => {
		const period = objectAt$1(candidate, `${path}.periods[${index}]`);
		exactFields$2(period, [
			"index",
			"time",
			"selectedCentroid",
			"fullCentroid",
			"selectedStepDistance",
			"fullStepDistance",
			"selectedCumulativeDistance",
			"fullCumulativeDistance"
		], `${path}.periods[${index}]`);
		if (nonNegativeInteger(period.index, `${path}.periods[${index}].index`) !== index) contractError$1(`${path}.periods[${index}].index`, "must equal its array position");
		assertTrajectoryIdentity(period.time, `${path}.periods[${index}].time`, true);
		for (const [field, length] of [["selectedCentroid", 3], ["fullCentroid", base.dimensions.length]]) {
			if (!Array.isArray(period[field]) || period[field].length !== length) contractError$1(`${path}.periods[${index}].${field}`, `must contain ${length} interval slots`);
			period[field].forEach((entry, itemIndex) => {
				if (entry !== null) assertBootstrapInterval(entry, `${path}.periods[${index}].${field}[${itemIndex}]`);
			});
		}
		for (const field of [
			"selectedStepDistance",
			"fullStepDistance",
			"selectedCumulativeDistance",
			"fullCumulativeDistance"
		]) if (period[field] !== null) assertBootstrapInterval(period[field], `${path}.periods[${index}].${field}`);
	});
	const quantile = objectAt$1(result.quantileRule, `${path}.quantileRule`);
	const expectedQuantile = {
		id: "linear-type7-v1",
		sort: "ascending-numeric",
		position: "(n-1)*p",
		interpolation: "linear-between-floor-and-ceiling",
		endpoints: "p=0-min-p=1-max"
	};
	exactFields$2(quantile, Object.keys(expectedQuantile), `${path}.quantileRule`);
	for (const [field, expected] of Object.entries(expectedQuantile)) if (quantile[field] !== expected) contractError$1(`${path}.quantileRule.${field}`, `must be ${expected}`);
	const resampling = objectAt$1(result.resampling, `${path}.resampling`);
	exactFields$2(resampling, [
		"unit",
		"stratified",
		"strata",
		"replicateCount",
		"planKind",
		"generation",
		"rngParityClaim"
	], `${path}.resampling`);
	if (resampling.unit !== "participant-complete-history" || !["participant-history-resample-indices-v1", "global-participant-history-resample-indices-v2"].includes(String(resampling.planKind)) || resampling.rngParityClaim !== false) contractError$1(`${path}.resampling`, "contains unsupported or unapproved resampling semantics");
	if (typeof resampling.stratified !== "boolean") contractError$1(`${path}.resampling.stratified`, "must be boolean");
	const replicateCount = positiveInteger(resampling.replicateCount, `${path}.resampling.replicateCount`);
	if (!Array.isArray(resampling.strata) || resampling.strata.length === 0) contractError$1(`${path}.resampling.strata`, "must be non-empty");
	resampling.strata.forEach((candidate, index) => {
		const stratum = objectAt$1(candidate, `${path}.resampling.strata[${index}]`);
		exactFields$2(stratum, ["key", "unitCount"], `${path}.resampling.strata[${index}]`);
		assertTrajectoryIdentity(stratum.key, `${path}.resampling.strata[${index}].key`, true);
		positiveInteger(stratum.unitCount, `${path}.resampling.strata[${index}].unitCount`);
	});
	const generation = objectAt$1(resampling.generation, `${path}.resampling.generation`);
	if (generation.kind === "caller-provided") exactFields$2(generation, ["kind"], `${path}.resampling.generation`);
	else {
		exactFields$2(generation, [
			"kind",
			"algorithm",
			"seed",
			"unitSort",
			"randomEndpoint"
		], `${path}.resampling.generation`);
		if (generation.kind !== "seeded" || generation.algorithm !== "mulberry32-uint32-v1" || generation.unitSort !== "utf16-code-unit-ascending" || generation.randomEndpoint !== "zero-inclusive-one-exclusive") contractError$1(`${path}.resampling.generation`, "contains unsupported seeded-generation semantics");
		if (nonNegativeInteger(generation.seed, `${path}.resampling.generation.seed`) > 4294967295) contractError$1(`${path}.resampling.generation.seed`, "must fit uint32");
	}
	result.periods.forEach((period) => {
		const candidate = period;
		for (const field of [
			"selectedStepDistance",
			"fullStepDistance",
			"selectedCumulativeDistance",
			"fullCumulativeDistance"
		]) {
			const interval = candidate[field];
			if (interval && interval.totalReplicates !== replicateCount) contractError$1(`${path}.periods.${field}`, "must bind the declared replicate count");
		}
	});
	assertDiagnostics(result.diagnostics, `${path}.diagnostics`);
}
/** Strict per-field validator for all seven public result variants. */
function assertAnalysisTaskResultV1(value, taskKind, path = "result") {
	switch (taskKind) {
		case "ena-model":
			assertAnalysisResult(value, path);
			return;
		case "prepared-import":
			assertPreparedDerivedSource(value);
			return;
		case "network-comparison":
			assertNetworkComparison(value, path);
			return;
		case "change-network":
			assertChangeNetwork(value, path);
			return;
		case "statistics":
			assertStatisticsTaskResult(value, path);
			return;
		case "trajectory":
			assertTrajectoryDynamics(value, path);
			return;
		case "trajectory-comparison":
			assertTrajectoryComparison(value, path);
			return;
		case "bootstrap":
			assertBootstrap(value, path);
			return;
		default: contractError$1("taskKind", "is unsupported");
	}
}
function assertProvenanceManifestV1(value, path = "provenance") {
	const manifest = objectAt$1(value, path);
	exactFields$2(manifest, [
		"schemaVersion",
		"datasetHash",
		"specHash",
		"resultHash",
		"adapterVersion",
		"jenaPackage",
		"jenaVersion",
		"jenaCommit",
		"sourceKind",
		"jenaExecuted",
		"sdkPackage",
		"sdkVersion",
		"appVersion",
		"contractVersion",
		"buildId",
		"seed",
		"toleranceContract",
		"schemaVersions",
		"generatedAt"
	], path);
	if (manifest.schemaVersion !== "3dena.provenance-manifest.v1") contractError$1(`${path}.schemaVersion`, `must be ${PROVENANCE_MANIFEST_VERSION_V1}`);
	lowercaseSha256(manifest.datasetHash, `${path}.datasetHash`);
	lowercaseSha256(manifest.specHash, `${path}.specHash`);
	lowercaseSha256(manifest.resultHash, `${path}.resultHash`);
	for (const field of [
		"adapterVersion",
		"jenaVersion",
		"jenaCommit",
		"sdkVersion",
		"appVersion",
		"buildId"
	]) nonEmptyString$2(manifest[field], `${path}.${field}`);
	if (manifest.jenaPackage !== "jena-js") contractError$1(`${path}.jenaPackage`, "must be jena-js");
	if (manifest.sourceKind !== "raw-jena" && manifest.sourceKind !== "prepared-exchange") contractError$1(`${path}.sourceKind`, "must be raw-jena or prepared-exchange");
	if (typeof manifest.jenaExecuted !== "boolean") contractError$1(`${path}.jenaExecuted`, "must be boolean");
	if (manifest.sourceKind === "raw-jena" && manifest.jenaExecuted !== true) contractError$1(`${path}.jenaExecuted`, "must be true for raw-jena");
	if (manifest.sourceKind === "prepared-exchange" && manifest.jenaExecuted !== false) contractError$1(`${path}.jenaExecuted`, "must be false for prepared-exchange");
	if (manifest.sdkPackage !== "@3dena/analysis") contractError$1(`${path}.sdkPackage`, "must be @3dena/analysis");
	if (manifest.contractVersion !== "3dena.contract.v1") contractError$1(`${path}.contractVersion`, `must be ${ANALYSIS_CONTRACT_VERSION_V1}`);
	if (manifest.seed !== null && (!Number.isSafeInteger(manifest.seed) || manifest.seed < 0 || manifest.seed > 4294967295)) contractError$1(`${path}.seed`, "must be null or an unsigned 32-bit integer");
	if (manifest.toleranceContract !== null && (typeof manifest.toleranceContract !== "string" || manifest.toleranceContract.trim() === "")) contractError$1(`${path}.toleranceContract`, "must be null or non-empty");
	stringList$1(manifest.schemaVersions, `${path}.schemaVersions`);
	const generatedAt = nonEmptyString$2(manifest.generatedAt, `${path}.generatedAt`);
	if (Number.isNaN(Date.parse(generatedAt))) contractError$1(`${path}.generatedAt`, "must be an ISO timestamp");
}
var HASH_SCHEMA = {
	type: "string",
	pattern: "^[a-f0-9]{64}$"
};
var NON_EMPTY_STRING_SCHEMA = {
	type: "string",
	minLength: 1
};
var RAW_SCALAR_SCHEMA = { oneOf: [
	{ type: "null" },
	{ type: "string" },
	{ type: "boolean" },
	{ type: "number" }
] };
var SAFE_NON_NEGATIVE_INTEGER_SCHEMA = {
	type: "integer",
	minimum: 0,
	maximum: Number.MAX_SAFE_INTEGER
};
var SAFE_POSITIVE_INTEGER_SCHEMA = {
	type: "integer",
	minimum: 1,
	maximum: Number.MAX_SAFE_INTEGER
};
var TASK_OWNER_SCHEMA_REF = { $ref: "https://3dena.com/schemas/task-owner.v1.json" };
var TRAJECTORY_V2_IDENTITY_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["components"],
	properties: { components: {
		type: "array",
		minItems: 1,
		items: { oneOf: [
			{
				type: "object",
				additionalProperties: false,
				required: [
					"name",
					"type",
					"value"
				],
				properties: {
					name: NON_EMPTY_STRING_SCHEMA,
					type: { const: "string" },
					value: { type: "string" },
					declaredType: NON_EMPTY_STRING_SCHEMA
				}
			},
			{
				type: "object",
				additionalProperties: false,
				required: [
					"name",
					"type",
					"value"
				],
				properties: {
					name: NON_EMPTY_STRING_SCHEMA,
					type: { const: "number" },
					value: { type: "number" },
					declaredType: NON_EMPTY_STRING_SCHEMA
				}
			},
			{
				type: "object",
				additionalProperties: false,
				required: [
					"name",
					"type",
					"value"
				],
				properties: {
					name: NON_EMPTY_STRING_SCHEMA,
					type: { const: "boolean" },
					value: { type: "boolean" },
					declaredType: NON_EMPTY_STRING_SCHEMA
				}
			}
		] }
	} }
};
var TRAJECTORY_V2_TIME_VALUE_SCHEMA = { oneOf: [
	{
		type: "object",
		additionalProperties: false,
		required: ["type", "index"],
		properties: {
			type: { const: "ordered-index-v2" },
			index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA
		}
	},
	{
		type: "object",
		additionalProperties: false,
		required: [
			"type",
			"value",
			"unit"
		],
		properties: {
			type: { const: "numeric-v1" },
			value: { type: "number" },
			unit: NON_EMPTY_STRING_SCHEMA
		}
	},
	{
		type: "object",
		additionalProperties: false,
		required: ["type", "value"],
		properties: {
			type: { const: "date-v1" },
			value: {
				type: "string",
				pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
			}
		}
	},
	{
		type: "object",
		additionalProperties: false,
		required: [
			"type",
			"epochMilliseconds",
			"timeZone",
			"offsetMinutes",
			"fold",
			"elapsedUnit"
		],
		properties: {
			type: { const: "instant-v1" },
			epochMilliseconds: {
				type: "string",
				pattern: "^-?(?:0|[1-9][0-9]*)$"
			},
			timeZone: NON_EMPTY_STRING_SCHEMA,
			offsetMinutes: {
				type: "integer",
				minimum: -1440,
				maximum: 1440
			},
			fold: { enum: [0, 1] },
			elapsedUnit: { enum: [...TRAJECTORY_DURATION_UNITS] }
		}
	},
	{
		type: "object",
		additionalProperties: false,
		required: [
			"type",
			"value",
			"unit",
			"elapsedUnit"
		],
		properties: {
			type: { const: "difftime-v1" },
			value: { type: "number" },
			unit: { enum: [...TRAJECTORY_DURATION_UNITS] },
			elapsedUnit: { enum: [...TRAJECTORY_DURATION_UNITS] }
		}
	}
] };
var TRAJECTORY_RUN_SPEC_V2_SCHEMA = {
	$id: "https://3dena.com/schemas/trajectory-run-spec.v2.json",
	type: "object",
	additionalProperties: false,
	required: [
		"schemaVersion",
		"sourceResultHash",
		"participantColumns",
		"timeColumn",
		"groupColumn",
		"orderedPeriods",
		"selectedDimensions",
		"cohortPolicy",
		"missingValuePolicy",
		"estimand"
	],
	properties: {
		schemaVersion: { const: "3dena.trajectory-run-spec.v2" },
		sourceResultHash: HASH_SCHEMA,
		participantColumns: {
			type: "array",
			minItems: 1,
			uniqueItems: true,
			items: NON_EMPTY_STRING_SCHEMA
		},
		timeColumn: NON_EMPTY_STRING_SCHEMA,
		groupColumn: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
		orderedPeriods: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"identity",
					"sourceTimeCanonical",
					"displayLabel",
					"expected",
					"value"
				],
				properties: {
					identity: TRAJECTORY_V2_IDENTITY_SCHEMA,
					sourceTimeCanonical: NON_EMPTY_STRING_SCHEMA,
					displayLabel: NON_EMPTY_STRING_SCHEMA,
					expected: { type: "boolean" },
					value: TRAJECTORY_V2_TIME_VALUE_SCHEMA
				}
			}
		},
		selectedDimensions: {
			type: "array",
			minItems: 3,
			maxItems: 3,
			uniqueItems: true,
			items: NON_EMPTY_STRING_SCHEMA
		},
		cohortPolicy: { enum: ["available", "complete"] },
		missingValuePolicy: { const: "complete-analytical-rows" },
		estimand: { oneOf: [{
			type: "object",
			additionalProperties: false,
			required: ["kind"],
			properties: { kind: { const: "equal-participant" } }
		}, {
			type: "object",
			additionalProperties: false,
			required: ["kind", "metadataField"],
			properties: {
				kind: { const: "weighted-participant" },
				metadataField: NON_EMPTY_STRING_SCHEMA
			}
		}] }
	}
};
var TRAJECTORY_V2_TASK_BINDING_PROPERTIES = {
	datasetHash: HASH_SCHEMA,
	specHash: HASH_SCHEMA,
	sourceResultHash: HASH_SCHEMA,
	runId: NON_EMPTY_STRING_SCHEMA
};
var LONGITUDINAL_NULLABLE_NUMBER_SCHEMA = { oneOf: [{ type: "null" }, { type: "number" }] };
var LONGITUDINAL_NULLABLE_PROBABILITY_SCHEMA = { oneOf: [{ type: "null" }, {
	type: "number",
	minimum: 0,
	maximum: 1
}] };
var LONGITUDINAL_NULLABLE_POSITIVE_INTEGER_SCHEMA = { oneOf: [{ type: "null" }, SAFE_POSITIVE_INTEGER_SCHEMA] };
var LONGITUDINAL_RANK_TIES_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"groups",
		"observations",
		"correctionSum"
	],
	properties: {
		groups: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		observations: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		correctionSum: {
			type: "number",
			minimum: 0
		}
	}
};
var LONGITUDINAL_RANK_EXACT_TAIL_SCHEMA = { oneOf: [{ type: "null" }, {
	type: "object",
	additionalProperties: false,
	required: [
		"extremeAssignmentCount",
		"totalAssignmentCount",
		"inclusive",
		"midP"
	],
	properties: {
		extremeAssignmentCount: {
			type: "string",
			pattern: "^(?:0|[1-9][0-9]*)$"
		},
		totalAssignmentCount: {
			type: "string",
			pattern: "^(?:0|[1-9][0-9]*)$"
		},
		inclusive: { const: true },
		midP: { const: false }
	}
}] };
var LONGITUDINAL_PAIRED_IDENTITY_AUDIT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"earlier",
		"later",
		"overlap",
		"earlierOnly",
		"laterOnly",
		"samePhysicalEntityConfirmed"
	],
	properties: {
		earlier: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		later: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		overlap: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		earlierOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		laterOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		samePhysicalEntityConfirmed: { const: true }
	}
};
var LONGITUDINAL_REPEATED_IDENTITY_AUDIT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"totalEntities",
		"completeBlocks",
		"excludedIncomplete",
		"samePhysicalEntityConfirmed"
	],
	properties: {
		totalEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		completeBlocks: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		excludedIncomplete: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		samePhysicalEntityConfirmed: { const: true }
	}
};
var LONGITUDINAL_RANK_ROW_COMMON_REQUIRED = [
	"memberId",
	"test",
	"design",
	"estimand",
	"axis",
	"axisIndex",
	"status",
	"reason",
	"effect",
	"statistic",
	"pRaw",
	"method",
	"ties",
	"zeros",
	"exactTail",
	"familyId",
	"familySize",
	"pHolm",
	"holmRank",
	"holmMultiplier"
];
var LONGITUDINAL_RANK_ROW_COMMON_PROPERTIES = {
	memberId: NON_EMPTY_STRING_SCHEMA,
	estimand: NON_EMPTY_STRING_SCHEMA,
	axis: NON_EMPTY_STRING_SCHEMA,
	axisIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
	status: { enum: ["available", "not-estimable"] },
	reason: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
	effect: LONGITUDINAL_NULLABLE_NUMBER_SCHEMA,
	statistic: LONGITUDINAL_NULLABLE_NUMBER_SCHEMA,
	pRaw: LONGITUDINAL_NULLABLE_PROBABILITY_SCHEMA,
	method: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
	ties: LONGITUDINAL_RANK_TIES_SCHEMA,
	zeros: { oneOf: [{ type: "null" }, SAFE_NON_NEGATIVE_INTEGER_SCHEMA] },
	exactTail: LONGITUDINAL_RANK_EXACT_TAIL_SCHEMA,
	familyId: NON_EMPTY_STRING_SCHEMA,
	familySize: SAFE_POSITIVE_INTEGER_SCHEMA,
	pHolm: LONGITUDINAL_NULLABLE_PROBABILITY_SCHEMA,
	holmRank: LONGITUDINAL_NULLABLE_POSITIVE_INTEGER_SCHEMA,
	holmMultiplier: LONGITUDINAL_NULLABLE_POSITIVE_INTEGER_SCHEMA
};
var LONGITUDINAL_INFERENCE_ROW_SCHEMA = { oneOf: [
	{
		type: "object",
		additionalProperties: false,
		required: [
			"memberId",
			"sideAEntities",
			"sideBEntities",
			"overlappingEntities",
			"pairedCompleteEntities",
			"sideAOnly",
			"sideBOnly",
			"excludedIncompleteOverlap",
			"samePhysicalEntityConfirmed"
		],
		properties: {
			memberId: { const: "identity-overlap-audit" },
			sideAEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			sideBEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			overlappingEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			pairedCompleteEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			sideAOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			sideBOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			excludedIncompleteOverlap: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			samePhysicalEntityConfirmed: { const: true }
		}
	},
	{
		type: "object",
		additionalProperties: false,
		required: [
			...LONGITUDINAL_RANK_ROW_COMMON_REQUIRED,
			"periodCanonical",
			"nPrimary",
			"nSecondary"
		],
		properties: {
			...LONGITUDINAL_RANK_ROW_COMMON_PROPERTIES,
			test: { const: "mann-whitney" },
			design: { const: "independent" },
			periodCanonical: NON_EMPTY_STRING_SCHEMA,
			nPrimary: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			nSecondary: SAFE_NON_NEGATIVE_INTEGER_SCHEMA
		}
	},
	{
		type: "object",
		additionalProperties: false,
		required: [
			...LONGITUDINAL_RANK_ROW_COMMON_REQUIRED,
			"earlierPeriodCanonical",
			"laterPeriodCanonical",
			"n",
			"identityOverlapAudit"
		],
		properties: {
			...LONGITUDINAL_RANK_ROW_COMMON_PROPERTIES,
			test: { const: "wilcoxon-signed-rank" },
			design: { const: "paired" },
			earlierPeriodCanonical: NON_EMPTY_STRING_SCHEMA,
			laterPeriodCanonical: NON_EMPTY_STRING_SCHEMA,
			n: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			identityOverlapAudit: LONGITUDINAL_PAIRED_IDENTITY_AUDIT_SCHEMA
		}
	},
	{
		type: "object",
		additionalProperties: false,
		required: [
			...LONGITUDINAL_RANK_ROW_COMMON_REQUIRED,
			"selectedPeriodCanonicals",
			"n",
			"identityOverlapAudit"
		],
		properties: {
			...LONGITUDINAL_RANK_ROW_COMMON_PROPERTIES,
			test: { const: "friedman" },
			design: { const: "repeated" },
			selectedPeriodCanonicals: {
				type: "array",
				minItems: 3,
				uniqueItems: true,
				items: NON_EMPTY_STRING_SCHEMA
			},
			n: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			identityOverlapAudit: LONGITUDINAL_REPEATED_IDENTITY_AUDIT_SCHEMA
		}
	},
	{
		type: "object",
		additionalProperties: false,
		required: [
			...LONGITUDINAL_RANK_ROW_COMMON_REQUIRED,
			"earlierPeriodCanonical",
			"laterPeriodCanonical",
			"n",
			"identityOverlapAudit"
		],
		properties: {
			...LONGITUDINAL_RANK_ROW_COMMON_PROPERTIES,
			test: { const: "wilcoxon-signed-rank" },
			design: { const: "repeated-posthoc" },
			earlierPeriodCanonical: NON_EMPTY_STRING_SCHEMA,
			laterPeriodCanonical: NON_EMPTY_STRING_SCHEMA,
			n: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			identityOverlapAudit: LONGITUDINAL_REPEATED_IDENTITY_AUDIT_SCHEMA
		}
	}
] };
var LONGITUDINAL_BOOTSTRAP_INTERVAL_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"estimate",
		"lower",
		"upper",
		"finiteReplicates",
		"requiredFiniteReplicates",
		"totalReplicates"
	],
	properties: {
		estimate: { type: "number" },
		lower: { type: "number" },
		upper: { type: "number" },
		finiteReplicates: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
		requiredFiniteReplicates: SAFE_POSITIVE_INTEGER_SCHEMA,
		totalReplicates: SAFE_POSITIVE_INTEGER_SCHEMA
	}
};
var PREPARED_MAPPING_TASK_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"participant",
		"participantLabel",
		"group",
		"time",
		"timeOrder",
		"cohortPolicy",
		"displayDimensions",
		"missingDisplayCoordinates"
	],
	properties: {
		participant: {
			type: "array",
			minItems: 1,
			uniqueItems: true,
			items: NON_EMPTY_STRING_SCHEMA
		},
		participantLabel: NON_EMPTY_STRING_SCHEMA,
		group: NON_EMPTY_STRING_SCHEMA,
		time: NON_EMPTY_STRING_SCHEMA,
		timeOrder: {
			type: "array",
			minItems: 1,
			uniqueItems: true,
			items: RAW_SCALAR_SCHEMA
		},
		cohortPolicy: { enum: ["available", "complete"] },
		displayDimensions: {
			type: "array",
			minItems: 3,
			maxItems: 3,
			uniqueItems: true,
			items: NON_EMPTY_STRING_SCHEMA
		},
		missingDisplayCoordinates: { const: "reject" }
	}
};
function analysisTaskSchema(kind, required, properties) {
	return {
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"kind",
			"owner",
			"deadlineEpochMilliseconds",
			...required
		],
		properties: {
			schemaVersion: { const: ANALYSIS_TASK_VERSION_V1 },
			kind: { const: kind },
			owner: TASK_OWNER_SCHEMA_REF,
			deadlineEpochMilliseconds: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			...properties
		}
	};
}
Object.freeze({
	typedScalar: Object.freeze({
		$id: "https://3dena.com/schemas/typed-scalar.v1.json",
		oneOf: [
			{
				type: "object",
				additionalProperties: false,
				required: ["type"],
				properties: { type: { const: "null" } }
			},
			{
				type: "object",
				additionalProperties: false,
				required: ["type", "value"],
				properties: {
					type: { const: "string" },
					value: { type: "string" }
				}
			},
			{
				type: "object",
				additionalProperties: false,
				required: ["type", "value"],
				properties: {
					type: { const: "boolean" },
					value: { type: "boolean" }
				}
			},
			{
				type: "object",
				additionalProperties: false,
				required: ["type", "value"],
				properties: {
					type: { const: "int64" },
					value: {
						type: "string",
						pattern: "^-?(?:0|[1-9][0-9]*)$"
					}
				}
			},
			{
				type: "object",
				additionalProperties: false,
				required: ["type", "ieee754Hex"],
				properties: {
					type: { const: "double" },
					ieee754Hex: {
						type: "string",
						pattern: "^[a-f0-9]{16}$"
					}
				}
			},
			{
				type: "object",
				additionalProperties: false,
				required: ["type", "value"],
				properties: {
					type: { const: "date" },
					value: {
						type: "string",
						pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
					}
				}
			},
			{
				type: "object",
				additionalProperties: false,
				required: [
					"type",
					"epochMilliseconds",
					"timeZone",
					"offsetMinutes",
					"fold"
				],
				properties: {
					type: { const: "instant" },
					epochMilliseconds: {
						type: "string",
						pattern: "^-?(?:0|[1-9][0-9]*)$"
					},
					timeZone: NON_EMPTY_STRING_SCHEMA,
					offsetMinutes: {
						type: "integer",
						minimum: -1440,
						maximum: 1440
					},
					fold: { enum: [0, 1] }
				}
			},
			{
				type: "object",
				additionalProperties: false,
				required: [
					"type",
					"value",
					"unit"
				],
				properties: {
					type: { const: "duration" },
					value: {
						type: "string",
						pattern: "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$"
					},
					unit: { enum: [...DURATION_UNITS] }
				}
			},
			{
				type: "object",
				additionalProperties: false,
				required: [
					"type",
					"value",
					"levels",
					"ordered"
				],
				properties: {
					type: { const: "factor" },
					value: { type: "string" },
					levels: {
						type: "array",
						uniqueItems: true,
						items: { type: "string" }
					},
					ordered: { type: "boolean" }
				}
			}
		]
	}),
	typedKey: Object.freeze({
		$id: "https://3dena.com/schemas/typed-key.v1.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"components",
			"canonical"
		],
		properties: {
			schemaVersion: { const: "3dena.typed-key.v1" },
			components: {
				type: "array",
				minItems: 1,
				items: {
					type: "object",
					additionalProperties: false,
					required: ["name", "value"],
					properties: {
						name: NON_EMPTY_STRING_SCHEMA,
						value: { $ref: "https://3dena.com/schemas/typed-scalar.v1.json" }
					}
				}
			},
			canonical: NON_EMPTY_STRING_SCHEMA
		}
	}),
	taskOwner: Object.freeze({
		$id: "https://3dena.com/schemas/task-owner.v1.json",
		type: "object",
		additionalProperties: false,
		required: [
			"contractVersion",
			"datasetHash",
			"specHash",
			"runId",
			"taskId"
		],
		properties: {
			contractVersion: { const: ANALYSIS_CONTRACT_VERSION_V1 },
			datasetHash: HASH_SCHEMA,
			specHash: HASH_SCHEMA,
			runId: NON_EMPTY_STRING_SCHEMA,
			taskId: NON_EMPTY_STRING_SCHEMA
		}
	}),
	datasetReceipt: Object.freeze({
		$id: "https://3dena.com/schemas/dataset-receipt.v1.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"sha256",
			"byteLength",
			"format",
			"sheet",
			"rows",
			"columns",
			"schema",
			"limits",
			"warnings",
			"activationIdentity"
		],
		properties: {
			schemaVersion: { const: DATASET_RECEIPT_VERSION_V1 },
			sha256: HASH_SCHEMA,
			byteLength: SAFE_POSITIVE_INTEGER_SCHEMA,
			format: { enum: [
				"csv",
				"xlsx",
				"xls",
				"ena3d-json"
			] },
			sheet: { oneOf: [{ type: "null" }, {
				type: "object",
				additionalProperties: false,
				required: ["index", "name"],
				properties: {
					index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
					name: NON_EMPTY_STRING_SCHEMA
				}
			}] },
			rows: SAFE_POSITIVE_INTEGER_SCHEMA,
			columns: SAFE_POSITIVE_INTEGER_SCHEMA,
			schema: {
				type: "object",
				additionalProperties: false,
				required: [
					"schemaVersion",
					"headers",
					"columns"
				],
				properties: {
					schemaVersion: { const: "3dena.dataset-schema.v1" },
					headers: {
						type: "array",
						minItems: 1,
						uniqueItems: true,
						items: NON_EMPTY_STRING_SCHEMA
					},
					columns: {
						type: "array",
						minItems: 1,
						items: {
							type: "object",
							additionalProperties: false,
							required: [
								"name",
								"inferredType",
								"roles"
							],
							properties: {
								name: NON_EMPTY_STRING_SCHEMA,
								inferredType: { enum: [
									"string",
									"number",
									"boolean",
									"mixed",
									"null"
								] },
								roles: {
									type: "array",
									minItems: 1,
									uniqueItems: true,
									items: { enum: [
										"unit",
										"conversation",
										"time",
										"code",
										"group",
										"metadata",
										"unmapped"
									] }
								}
							}
						}
					}
				}
			},
			limits: {
				type: "object",
				additionalProperties: false,
				required: [
					"schemaVersion",
					"maxFileBytes",
					"maxWorksheets",
					"maxRows",
					"maxColumns",
					"maxCells"
				],
				properties: {
					schemaVersion: { const: "3dena.dataset-limits.v1" },
					maxFileBytes: SAFE_POSITIVE_INTEGER_SCHEMA,
					maxWorksheets: SAFE_POSITIVE_INTEGER_SCHEMA,
					maxRows: SAFE_POSITIVE_INTEGER_SCHEMA,
					maxColumns: SAFE_POSITIVE_INTEGER_SCHEMA,
					maxCells: SAFE_POSITIVE_INTEGER_SCHEMA
				}
			},
			warnings: {
				type: "array",
				uniqueItems: true,
				items: { type: "string" }
			},
			activationIdentity: NON_EMPTY_STRING_SCHEMA
		}
	}),
	analysisExecutionDatasetV2: Object.freeze(ANALYSIS_EXECUTION_DATASET_V2_SCHEMA),
	trajectoryRunSpecV2: Object.freeze(TRAJECTORY_RUN_SPEC_V2_SCHEMA),
	trajectoryPathTaskV2: Object.freeze({
		$id: "https://3dena.com/schemas/trajectory-path-task.v2.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"kind",
			"datasetHash",
			"specHash",
			"runId",
			"runSpec"
		],
		properties: {
			schemaVersion: { const: "3dena.trajectory-path-task.v2" },
			kind: { const: "trajectory-path-v2" },
			datasetHash: HASH_SCHEMA,
			specHash: HASH_SCHEMA,
			runId: NON_EMPTY_STRING_SCHEMA,
			runSpec: { $ref: "https://3dena.com/schemas/trajectory-run-spec.v2.json" }
		}
	}),
	trajectoryInferenceTaskV2: Object.freeze({
		$id: "https://3dena.com/schemas/trajectory-inference-task.v2.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"kind",
			"datasetHash",
			"specHash",
			"sourceResultHash",
			"runId",
			"requests",
			"adjustment"
		],
		properties: {
			schemaVersion: { const: "3dena.trajectory-inference-task.v2" },
			kind: { const: "trajectory-inference-v2" },
			...TRAJECTORY_V2_TASK_BINDING_PROPERTIES,
			adjustment: { const: "holm" },
			requests: {
				type: "array",
				minItems: 1,
				items: { oneOf: [
					{
						type: "object",
						additionalProperties: false,
						required: [
							"kind",
							"groups",
							"periodCanonical"
						],
						properties: {
							kind: { const: "independent-period" },
							groups: {
								type: "array",
								minItems: 2,
								maxItems: 2,
								uniqueItems: true,
								items: NON_EMPTY_STRING_SCHEMA
							},
							periodCanonical: NON_EMPTY_STRING_SCHEMA
						}
					},
					{
						type: "object",
						additionalProperties: false,
						required: [
							"kind",
							"group",
							"earlierPeriodCanonical",
							"laterPeriodCanonical",
							"samePhysicalEntityConfirmed"
						],
						properties: {
							kind: { const: "paired-periods" },
							group: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
							earlierPeriodCanonical: NON_EMPTY_STRING_SCHEMA,
							laterPeriodCanonical: NON_EMPTY_STRING_SCHEMA,
							samePhysicalEntityConfirmed: { type: "boolean" }
						}
					},
					{
						type: "object",
						additionalProperties: false,
						required: [
							"kind",
							"group",
							"periodCanonicals",
							"samePhysicalEntityConfirmed"
						],
						properties: {
							kind: { const: "repeated-periods" },
							group: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
							periodCanonicals: {
								type: "array",
								minItems: 3,
								uniqueItems: true,
								items: NON_EMPTY_STRING_SCHEMA
							},
							samePhysicalEntityConfirmed: { type: "boolean" }
						}
					},
					{
						type: "object",
						additionalProperties: false,
						required: [
							"kind",
							"design",
							"groups",
							"repetitions",
							"seed",
							"samePhysicalEntityConfirmed"
						],
						properties: {
							kind: { const: "path-comparison" },
							design: { enum: ["independent", "paired"] },
							groups: {
								type: "array",
								minItems: 2,
								maxItems: 2,
								uniqueItems: true,
								items: NON_EMPTY_STRING_SCHEMA
							},
							repetitions: {
								type: "integer",
								minimum: 1,
								maximum: 1e4
							},
							seed: {
								type: "integer",
								minimum: 0,
								maximum: 4294967295
							},
							samePhysicalEntityConfirmed: { type: "boolean" }
						}
					}
				] }
			}
		}
	}),
	trajectoryBootstrapTaskV2: Object.freeze({
		$id: "https://3dena.com/schemas/trajectory-bootstrap-task.v2.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"kind",
			"datasetHash",
			"specHash",
			"sourceResultHash",
			"runId",
			"repetitions",
			"confidenceLevel",
			"seed",
			"resamplingDesign",
			"explicitStrataField",
			"interval",
			"rotationPolicy"
		],
		properties: {
			schemaVersion: { const: "3dena.trajectory-bootstrap-task.v2" },
			kind: { const: "trajectory-bootstrap-v2" },
			...TRAJECTORY_V2_TASK_BINDING_PROPERTIES,
			repetitions: {
				type: "integer",
				minimum: 1,
				maximum: 1e4
			},
			confidenceLevel: {
				type: "number",
				exclusiveMinimum: 0,
				exclusiveMaximum: 1
			},
			seed: {
				type: "integer",
				minimum: 0,
				maximum: 4294967295
			},
			resamplingDesign: { enum: [
				"auto",
				"global-participant",
				"within-group",
				"explicit-strata"
			] },
			explicitStrataField: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
			interval: { const: "pointwise-percentile-linear-type7" },
			rotationPolicy: { const: "fixed-same-fit-projection" }
		},
		allOf: [{
			if: { properties: { resamplingDesign: { const: "explicit-strata" } } },
			then: { properties: { explicitStrataField: NON_EMPTY_STRING_SCHEMA } },
			else: { properties: { explicitStrataField: { type: "null" } } }
		}]
	}),
	trajectoryNetworkOverlayTaskV2: Object.freeze({
		$id: "https://3dena.com/schemas/trajectory-network-overlay-task.v2.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"kind",
			"datasetHash",
			"specHash",
			"sourceResultHash",
			"runId",
			"requests"
		],
		properties: {
			schemaVersion: { const: "3dena.trajectory-network-overlay-task.v2" },
			kind: { const: "trajectory-network-overlay-v2" },
			...TRAJECTORY_V2_TASK_BINDING_PROPERTIES,
			requests: {
				type: "array",
				minItems: 1,
				items: {
					type: "object",
					additionalProperties: false,
					required: ["periodCanonical", "groupCanonical"],
					properties: {
						periodCanonical: NON_EMPTY_STRING_SCHEMA,
						groupCanonical: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] }
					}
				}
			}
		}
	}),
	trajectoryDisplaySpecV2: Object.freeze({
		$id: "https://3dena.com/schemas/trajectory-display-spec.v2.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"projection",
			"displayedGroups",
			"traces",
			"axisFlips",
			"camera",
			"style"
		],
		properties: {
			schemaVersion: { const: "3dena.trajectory-display-spec.v2" },
			projection: { enum: [
				"3d",
				"xy",
				"xz",
				"yz",
				"yx",
				"zx",
				"zy"
			] },
			displayedGroups: {
				type: "array",
				uniqueItems: true,
				items: NON_EMPTY_STRING_SCHEMA
			},
			traces: {
				type: "object",
				additionalProperties: false,
				required: [
					"participants",
					"individualPaths",
					"centroids",
					"paths",
					"directionArrows",
					"uncertainty",
					"networkOverlay",
					"labels"
				],
				properties: Object.fromEntries([
					"participants",
					"individualPaths",
					"centroids",
					"paths",
					"directionArrows",
					"uncertainty",
					"networkOverlay",
					"codeNodes",
					"labels"
				].map((field) => [field, { type: "boolean" }]))
			},
			axisFlips: {
				type: "array",
				minItems: 3,
				maxItems: 3,
				items: { type: "boolean" }
			},
			camera: { oneOf: [{ type: "null" }, {
				type: "object",
				additionalProperties: false,
				required: [
					"eye",
					"center",
					"up"
				],
				properties: {
					...Object.fromEntries([
						"eye",
						"center",
						"up"
					].map((field) => [field, {
						type: "object",
						additionalProperties: false,
						required: [
							"x",
							"y",
							"z"
						],
						properties: {
							x: { type: "number" },
							y: { type: "number" },
							z: { type: "number" }
						}
					}])),
					projection: {
						type: "object",
						additionalProperties: false,
						required: ["type"],
						properties: { type: { enum: ["perspective", "orthographic"] } }
					}
				}
			}] },
			style: {
				type: "object",
				additionalProperties: false,
				required: [
					"participantSize",
					"participantOpacity",
					"centroidSize",
					"pathWidth"
				],
				properties: {
					participantSize: {
						type: "number",
						exclusiveMinimum: 0
					},
					participantOpacity: {
						type: "number",
						minimum: 0,
						maximum: 1
					},
					centroidSize: {
						type: "number",
						exclusiveMinimum: 0
					},
					pathWidth: {
						type: "number",
						exclusiveMinimum: 0
					}
				}
			}
		}
	}),
	longitudinalAnalysisBundleV2: Object.freeze({
		$id: "https://3dena.com/schemas/longitudinal-analysis-bundle.v2.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"identity",
			"runSpec",
			"model",
			"paths",
			"inference",
			"pathComparisons",
			"bootstrap",
			"codeGeometry",
			"networkOverlays",
			"diagnostics",
			"execution"
		],
		properties: {
			schemaVersion: { const: "3dena.longitudinal-analysis-bundle.v2" },
			identity: {
				type: "object",
				additionalProperties: false,
				required: [
					"datasetHash",
					"specHash",
					"sourceResultHash",
					"requestHash",
					"resultHash",
					"runId",
					"jenaBuildId"
				],
				properties: {
					datasetHash: HASH_SCHEMA,
					specHash: HASH_SCHEMA,
					sourceResultHash: HASH_SCHEMA,
					requestHash: HASH_SCHEMA,
					resultHash: HASH_SCHEMA,
					runId: NON_EMPTY_STRING_SCHEMA,
					jenaBuildId: NON_EMPTY_STRING_SCHEMA
				}
			},
			runSpec: { $ref: "https://3dena.com/schemas/trajectory-run-spec.v2.json" },
			model: {
				type: "object",
				additionalProperties: false,
				required: [
					"type",
					"fullRotationDimensions",
					"selectedDimensions"
				],
				properties: {
					type: { enum: ["SeparateTrajectory", "AccumulatedTrajectory"] },
					fullRotationDimensions: {
						type: "array",
						minItems: 3,
						uniqueItems: true,
						items: NON_EMPTY_STRING_SCHEMA
					},
					selectedDimensions: {
						type: "array",
						minItems: 3,
						maxItems: 3,
						uniqueItems: true,
						items: NON_EMPTY_STRING_SCHEMA
					}
				}
			},
			paths: {
				type: "array",
				minItems: 1,
				items: {
					type: "object",
					additionalProperties: false,
					required: ["group", "dynamics"],
					properties: {
						group: {
							type: "object",
							additionalProperties: false,
							required: ["canonical", "display"],
							properties: {
								canonical: NON_EMPTY_STRING_SCHEMA,
								display: NON_EMPTY_STRING_SCHEMA
							}
						},
						dynamics: RESULT_VARIANT_SCHEMAS_V1.trajectory
					}
				}
			},
			inference: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: [
						"request",
						"status",
						"familyId",
						"familySize",
						"rows",
						"reason"
					],
					properties: {
						request: { $ref: "https://3dena.com/schemas/trajectory-inference-task.v2.json#/properties/requests/items" },
						status: { enum: [
							"available",
							"not-estimable",
							"disabled"
						] },
						familyId: NON_EMPTY_STRING_SCHEMA,
						familySize: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
						rows: {
							type: "array",
							items: LONGITUDINAL_INFERENCE_ROW_SCHEMA
						},
						reason: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] }
					}
				}
			},
			pathComparisons: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: [
						"groups",
						"design",
						"seed",
						"planHash",
						"identityOverlapAudit",
						"result"
					],
					properties: {
						groups: {
							type: "array",
							minItems: 2,
							maxItems: 2,
							uniqueItems: true,
							items: NON_EMPTY_STRING_SCHEMA
						},
						design: { enum: ["independent", "paired"] },
						seed: {
							type: "integer",
							minimum: 0,
							maximum: 4294967295
						},
						planHash: HASH_SCHEMA,
						identityOverlapAudit: { oneOf: [{ type: "null" }, {
							type: "object",
							additionalProperties: false,
							required: [
								"sideAEntities",
								"sideBEntities",
								"overlappingEntities",
								"pairedCompleteEntities",
								"sideAOnly",
								"sideBOnly",
								"excludedIncompleteOverlap",
								"samePhysicalEntityConfirmed"
							],
							properties: {
								sideAEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
								sideBEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
								overlappingEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
								pairedCompleteEntities: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
								sideAOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
								sideBOnly: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
								excludedIncompleteOverlap: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
								samePhysicalEntityConfirmed: { const: true }
							}
						}] },
						result: RESULT_VARIANT_SCHEMAS_V1["trajectory-comparison"]
					}
				}
			},
			bootstrap: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: [
						"groupCanonical",
						"status",
						"notEstimableReason",
						"seed",
						"planHash",
						"finiteReplicates",
						"requiredFiniteReplicates",
						"totalReplicates",
						"confidenceLevel",
						"requestedResamplingDesign",
						"resolvedResamplingDesign",
						"resamplingAlgorithm",
						"intervalContract",
						"rotationPolicy",
						"speedIntervals",
						"result"
					],
					properties: {
						groupCanonical: NON_EMPTY_STRING_SCHEMA,
						status: { enum: ["available", "not-estimable"] },
						notEstimableReason: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
						seed: {
							type: "integer",
							minimum: 0,
							maximum: 4294967295
						},
						planHash: HASH_SCHEMA,
						finiteReplicates: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
						requiredFiniteReplicates: SAFE_POSITIVE_INTEGER_SCHEMA,
						totalReplicates: SAFE_POSITIVE_INTEGER_SCHEMA,
						confidenceLevel: {
							type: "number",
							exclusiveMinimum: 0,
							exclusiveMaximum: 1
						},
						requestedResamplingDesign: { enum: [
							"auto",
							"global-participant",
							"within-group",
							"explicit-strata"
						] },
						resolvedResamplingDesign: { enum: [
							"global-participant",
							"within-group",
							"explicit-strata"
						] },
						resamplingAlgorithm: { enum: ["participant-complete-history-mulberry32-uint32-v1", "global-participant-complete-history-mulberry32-uint32-v2"] },
						intervalContract: { const: "pointwise-percentile-linear-type7" },
						rotationPolicy: { const: "fixed-same-fit-projection" },
						speedIntervals: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: false,
								required: [
									"periodCanonical",
									"selected",
									"full"
								],
								properties: {
									periodCanonical: NON_EMPTY_STRING_SCHEMA,
									selected: { oneOf: [{ type: "null" }, LONGITUDINAL_BOOTSTRAP_INTERVAL_SCHEMA] },
									full: { oneOf: [{ type: "null" }, LONGITUDINAL_BOOTSTRAP_INTERVAL_SCHEMA] }
								}
							}
						},
						result: RESULT_VARIANT_SCHEMAS_V1.bootstrap
					}
				}
			},
			codeGeometry: {
				type: "object",
				additionalProperties: false,
				required: [
					"schemaVersion",
					"dimensions",
					"nodes"
				],
				properties: {
					schemaVersion: { const: "3dena.longitudinal-code-geometry.v2" },
					dimensions: {
						type: "array",
						minItems: 3,
						maxItems: 3,
						uniqueItems: true,
						items: NON_EMPTY_STRING_SCHEMA
					},
					nodes: {
						type: "array",
						minItems: 1,
						items: {
							type: "object",
							additionalProperties: false,
							required: [
								"index",
								"code",
								"coordinates"
							],
							properties: {
								index: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
								code: NON_EMPTY_STRING_SCHEMA,
								coordinates: {
									type: "array",
									minItems: 3,
									maxItems: 3,
									items: { type: "number" }
								}
							}
						}
					}
				}
			},
			networkOverlays: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: [
						"status",
						"reason",
						"groupCanonical",
						"periodCanonical",
						"dimensions",
						"estimand",
						"sourceRows",
						"participantPeriods",
						"effectiveParticipantN",
						"edges"
					],
					properties: {
						status: { enum: ["available", "not-estimable"] },
						reason: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
						groupCanonical: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
						periodCanonical: NON_EMPTY_STRING_SCHEMA,
						dimensions: {
							type: "array",
							minItems: 3,
							maxItems: 3,
							uniqueItems: true,
							items: NON_EMPTY_STRING_SCHEMA
						},
						estimand: { enum: ["equal-participant", "weighted-participant"] },
						sourceRows: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
						participantPeriods: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
						effectiveParticipantN: { oneOf: [{ type: "null" }, {
							type: "number",
							exclusiveMinimum: 0
						}] },
						edges: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: false,
								required: [
									"id",
									"sourceIndex",
									"targetIndex",
									"weight"
								],
								properties: {
									id: NON_EMPTY_STRING_SCHEMA,
									sourceIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
									targetIndex: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
									weight: { type: "number" }
								}
							}
						}
					}
				}
			},
			diagnostics: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: [
						"code",
						"severity",
						"message"
					],
					properties: {
						code: NON_EMPTY_STRING_SCHEMA,
						severity: { enum: [
							"error",
							"warning",
							"info"
						] },
						message: NON_EMPTY_STRING_SCHEMA,
						path: NON_EMPTY_STRING_SCHEMA
					}
				}
			},
			execution: {
				type: "object",
				additionalProperties: false,
				required: [
					"target",
					"jenaVersion",
					"jenaCommit",
					"jenaTarballIntegrity",
					"sdkVersion",
					"buildId",
					"seed",
					"permutationPlanHashes",
					"resamplingPlanHashes",
					"evidenceStatus"
				],
				properties: {
					target: { enum: [
						"browser-worker",
						"persistent-compute-service",
						"node-service"
					] },
					jenaVersion: NON_EMPTY_STRING_SCHEMA,
					jenaCommit: NON_EMPTY_STRING_SCHEMA,
					jenaTarballIntegrity: NON_EMPTY_STRING_SCHEMA,
					sdkVersion: NON_EMPTY_STRING_SCHEMA,
					buildId: NON_EMPTY_STRING_SCHEMA,
					seed: {
						type: "integer",
						minimum: 0,
						maximum: 4294967295
					},
					permutationPlanHashes: {
						type: "array",
						items: HASH_SCHEMA
					},
					resamplingPlanHashes: {
						type: "array",
						items: HASH_SCHEMA
					},
					evidenceStatus: { enum: [
						"IMPLEMENTED_UNVERIFIED",
						"PARITY_CANDIDATE",
						"PRODUCTION_CANDIDATE",
						"PRODUCTION_READY"
					] }
				}
			}
		}
	}),
	analysisSpec: Object.freeze({
		$id: "https://3dena.com/schemas/analysis-spec.v1.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"model",
			"window",
			"weightBy",
			"windowSizeBack",
			"windowSizeForward",
			"centerAlignToOrigin",
			"cohortPolicy"
		],
		properties: {
			schemaVersion: { const: "3dena.analysis-spec.v1" },
			model: { enum: [
				"EndPoint",
				"AccumulatedTrajectory",
				"SeparateTrajectory"
			] },
			window: { enum: ["MovingStanzaWindow", "Conversation"] },
			weightBy: { enum: ["binary", "sum"] },
			windowSizeBack: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			windowSizeForward: SAFE_NON_NEGATIVE_INTEGER_SCHEMA,
			centerAlignToOrigin: { type: "boolean" },
			cohortPolicy: { enum: ["available", "complete"] }
		}
	}),
	displaySpec: Object.freeze({
		$id: "https://3dena.com/schemas/display-spec.v1.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"dimensions",
			"plotDimension",
			"showGrid",
			"showZeroLines",
			"showAxes",
			"traces",
			"style",
			"camera"
		],
		properties: {
			schemaVersion: { const: "3dena.display-spec.v1" },
			dimensions: {
				type: "array",
				minItems: 3,
				maxItems: 3,
				uniqueItems: true,
				items: NON_EMPTY_STRING_SCHEMA
			},
			plotDimension: { enum: [2, 3] },
			groups: {
				type: "array",
				minItems: 1,
				uniqueItems: true,
				items: NON_EMPTY_STRING_SCHEMA
			},
			showGrid: { type: "boolean" },
			showZeroLines: { type: "boolean" },
			showAxes: { type: "boolean" },
			traces: {
				type: "object",
				additionalProperties: false,
				required: [
					"points",
					"nodes",
					"network",
					"centroids",
					"trajectory",
					"uncertainty"
				],
				properties: Object.fromEntries([
					"points",
					"nodes",
					"network",
					"centroids",
					"trajectory",
					"uncertainty"
				].map((name) => [name, { type: "boolean" }]))
			},
			style: {
				type: "object",
				additionalProperties: false,
				required: [
					"pointSize",
					"pointOpacity",
					"nodeSize",
					"nodeOpacity",
					"edgeThreshold",
					"edgeWidthScale",
					"trajectoryWidth"
				],
				properties: {
					pointSize: {
						type: "number",
						minimum: 1,
						maximum: 100
					},
					pointOpacity: {
						type: "number",
						minimum: 0,
						maximum: 1
					},
					nodeSize: {
						type: "number",
						minimum: 1,
						maximum: 100
					},
					nodeOpacity: {
						type: "number",
						minimum: 0,
						maximum: 1
					},
					edgeThreshold: {
						type: "number",
						minimum: 0,
						maximum: 1e9
					},
					edgeWidthScale: {
						type: "number",
						minimum: .01,
						maximum: 1e3
					},
					trajectoryWidth: {
						type: "number",
						minimum: .1,
						maximum: 100
					}
				}
			},
			camera: { oneOf: [{ type: "null" }, {
				type: "object",
				additionalProperties: false,
				required: [
					"eye",
					"center",
					"up"
				],
				properties: Object.fromEntries([
					"eye",
					"center",
					"up"
				].map((name) => [name, {
					type: "object",
					additionalProperties: false,
					required: [
						"x",
						"y",
						"z"
					],
					properties: {
						x: { type: "number" },
						y: { type: "number" },
						z: { type: "number" }
					}
				}]))
			}] }
		}
	}),
	analysisTask: Object.freeze({
		$id: "https://3dena.com/schemas/analysis-task.v1.json",
		discriminator: { propertyName: "kind" },
		$defs: {
			stringPair: {
				type: "array",
				minItems: 2,
				maxItems: 2,
				uniqueItems: true,
				items: NON_EMPTY_STRING_SCHEMA
			},
			timeValue: { oneOf: [
				{
					type: "object",
					additionalProperties: false,
					required: [
						"type",
						"value",
						"unit"
					],
					properties: {
						type: { const: "numeric-v1" },
						value: { type: "number" },
						unit: NON_EMPTY_STRING_SCHEMA
					}
				},
				{
					type: "object",
					additionalProperties: false,
					required: ["type", "value"],
					properties: {
						type: { const: "date-v1" },
						value: {
							type: "string",
							pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
						}
					}
				},
				{
					type: "object",
					additionalProperties: false,
					required: [
						"type",
						"epochMilliseconds",
						"timeZone",
						"offsetMinutes",
						"fold",
						"elapsedUnit"
					],
					properties: {
						type: { const: "instant-v1" },
						epochMilliseconds: {
							type: "string",
							pattern: "^-?(?:0|[1-9][0-9]*)$"
						},
						timeZone: NON_EMPTY_STRING_SCHEMA,
						offsetMinutes: {
							type: "integer",
							minimum: -1440,
							maximum: 1440
						},
						fold: { enum: [0, 1] },
						elapsedUnit: { enum: [...TRAJECTORY_DURATION_UNITS] }
					}
				},
				{
					type: "object",
					additionalProperties: false,
					required: [
						"type",
						"value",
						"unit",
						"elapsedUnit"
					],
					properties: {
						type: { const: "difftime-v1" },
						value: { type: "number" },
						unit: { enum: [...TRAJECTORY_DURATION_UNITS] },
						elapsedUnit: { enum: [...TRAJECTORY_DURATION_UNITS] }
					}
				}
			] }
		},
		oneOf: [
			analysisTaskSchema("ena-model", ["input"], { input: { type: "object" } }),
			analysisTaskSchema("prepared-import", ["input"], { input: {
				type: "object",
				additionalProperties: false,
				required: [
					"sourceName",
					"exactBytesBase64",
					"mapping"
				],
				properties: {
					sourceName: { const: "uploaded.ena3d.json" },
					exactBytesBase64: {
						type: "string",
						minLength: 4,
						maxLength: 7e6,
						pattern: "^[A-Za-z0-9+/]+={0,2}$"
					},
					mapping: PREPARED_MAPPING_TASK_SCHEMA
				}
			} }),
			analysisTaskSchema("network-comparison", ["sourceResultHash", "groups"], {
				sourceResultHash: HASH_SCHEMA,
				groups: { $ref: "#/$defs/stringPair" }
			}),
			analysisTaskSchema("change-network", [
				"sourceResultHash",
				"field",
				"level"
			], {
				sourceResultHash: HASH_SCHEMA,
				field: NON_EMPTY_STRING_SCHEMA,
				level: RAW_SCALAR_SCHEMA
			}),
			analysisTaskSchema("statistics", [
				"sourceResultHash",
				"design",
				"groups",
				"dimensions",
				"alternative",
				"adjustment",
				"samePhysicalEntityConfirmed"
			], {
				sourceResultHash: HASH_SCHEMA,
				design: { enum: ["independent", "paired"] },
				groups: { $ref: "#/$defs/stringPair" },
				dimensions: {
					type: "array",
					minItems: 1,
					uniqueItems: true,
					items: NON_EMPTY_STRING_SCHEMA
				},
				alternative: { enum: [
					"two-sided",
					"greater",
					"less"
				] },
				adjustment: { enum: [
					"none",
					"holm",
					"bh",
					"bonferroni"
				] },
				samePhysicalEntityConfirmed: { type: "boolean" }
			}),
			analysisTaskSchema("trajectory", [
				"sourceResultHash",
				"group",
				"selectedDimensions",
				"cohortPolicy",
				"periods",
				"estimand"
			], {
				sourceResultHash: HASH_SCHEMA,
				group: NON_EMPTY_STRING_SCHEMA,
				selectedDimensions: {
					type: "array",
					minItems: 3,
					maxItems: 3,
					uniqueItems: true,
					items: NON_EMPTY_STRING_SCHEMA
				},
				cohortPolicy: { enum: ["available", "complete"] },
				periods: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						additionalProperties: false,
						required: ["sourceTimeCanonical", "value"],
						properties: {
							sourceTimeCanonical: NON_EMPTY_STRING_SCHEMA,
							value: { $ref: "#/$defs/timeValue" }
						}
					}
				},
				estimand: { oneOf: [{
					type: "object",
					additionalProperties: false,
					required: ["kind"],
					properties: { kind: { const: "equal-participant-v1" } }
				}, {
					type: "object",
					additionalProperties: false,
					required: ["kind", "metadataField"],
					properties: {
						kind: { const: "weighted-participant-v1" },
						metadataField: NON_EMPTY_STRING_SCHEMA
					}
				}] }
			}),
			analysisTaskSchema("trajectory-comparison", [
				"sourceResultHash",
				"design",
				"groups",
				"samePhysicalEntityConfirmed"
			], {
				sourceResultHash: HASH_SCHEMA,
				design: { enum: ["independent", "paired"] },
				groups: { $ref: "#/$defs/stringPair" },
				samePhysicalEntityConfirmed: { type: "boolean" }
			}),
			analysisTaskSchema("bootstrap", [
				"sourceResultHash",
				"group",
				"replicates",
				"confidenceLevel",
				"seed",
				"interval",
				"rotationPolicy"
			], {
				sourceResultHash: HASH_SCHEMA,
				group: NON_EMPTY_STRING_SCHEMA,
				replicates: {
					type: "integer",
					minimum: 200,
					maximum: 500
				},
				confidenceLevel: {
					type: "number",
					exclusiveMinimum: 0,
					exclusiveMaximum: 1
				},
				seed: {
					type: "integer",
					minimum: 0,
					maximum: 4294967295
				},
				interval: { const: "pointwise-percentile-type7" },
				rotationPolicy: { const: "fixed-preprojected" }
			})
		]
	}),
	evidenceStamp: Object.freeze({
		$id: "https://3dena.com/schemas/evidence-stamp.v1.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"scope",
			"status",
			"approvedForParity"
		],
		properties: {
			schemaVersion: { const: "3dena.evidence-stamp.v1" },
			scope: { enum: [
				"fixture",
				"feature",
				"build",
				"deployment"
			] },
			status: { enum: [
				"IMPLEMENTED_UNVERIFIED",
				"PARITY_CANDIDATE",
				"VERIFIED_PARITY",
				"PRODUCTION_CANDIDATE",
				"PRODUCTION_READY",
				"PRECOMPUTED_COMPATIBILITY_CANDIDATE"
			] },
			datasetHash: HASH_SCHEMA,
			specHash: HASH_SCHEMA,
			fixtureId: NON_EMPTY_STRING_SCHEMA,
			buildId: NON_EMPTY_STRING_SCHEMA,
			approvedForParity: { type: "boolean" }
		}
	}),
	provenanceManifest: Object.freeze({
		$id: "https://3dena.com/schemas/provenance-manifest.v1.json",
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"datasetHash",
			"specHash",
			"resultHash",
			"adapterVersion",
			"jenaPackage",
			"jenaVersion",
			"jenaCommit",
			"sourceKind",
			"jenaExecuted",
			"sdkPackage",
			"sdkVersion",
			"appVersion",
			"contractVersion",
			"buildId",
			"seed",
			"toleranceContract",
			"schemaVersions",
			"generatedAt"
		],
		properties: {
			schemaVersion: { const: PROVENANCE_MANIFEST_VERSION_V1 },
			datasetHash: HASH_SCHEMA,
			specHash: HASH_SCHEMA,
			resultHash: HASH_SCHEMA,
			adapterVersion: NON_EMPTY_STRING_SCHEMA,
			jenaPackage: { const: "jena-js" },
			jenaVersion: NON_EMPTY_STRING_SCHEMA,
			jenaCommit: NON_EMPTY_STRING_SCHEMA,
			sourceKind: { enum: ["raw-jena", "prepared-exchange"] },
			jenaExecuted: { type: "boolean" },
			sdkPackage: { const: "@3dena/analysis" },
			sdkVersion: NON_EMPTY_STRING_SCHEMA,
			appVersion: NON_EMPTY_STRING_SCHEMA,
			contractVersion: { const: ANALYSIS_CONTRACT_VERSION_V1 },
			buildId: NON_EMPTY_STRING_SCHEMA,
			seed: { oneOf: [{ type: "null" }, {
				type: "integer",
				minimum: 0,
				maximum: 4294967295
			}] },
			toleranceContract: { oneOf: [{ type: "null" }, NON_EMPTY_STRING_SCHEMA] },
			schemaVersions: {
				type: "array",
				minItems: 1,
				uniqueItems: true,
				items: NON_EMPTY_STRING_SCHEMA
			},
			generatedAt: {
				type: "string",
				format: "date-time"
			}
		}
	}),
	resultEnvelope: Object.freeze({
		$id: "https://3dena.com/schemas/analysis-result-envelope.v1.json",
		discriminator: { propertyName: "taskKind" },
		type: "object",
		additionalProperties: false,
		required: [
			"schemaVersion",
			"owner",
			"taskKind",
			"result",
			"diagnostics",
			"evidence",
			"provenance"
		],
		properties: {
			schemaVersion: { const: RESULT_ENVELOPE_VERSION_V1 },
			owner: TASK_OWNER_SCHEMA_REF,
			taskKind: { enum: [
				"ena-model",
				"prepared-import",
				"network-comparison",
				"change-network",
				"statistics",
				"trajectory",
				"trajectory-comparison",
				"bootstrap"
			] },
			result: { oneOf: Object.values(RESULT_VARIANT_SCHEMAS_V1) },
			diagnostics: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					required: [
						"code",
						"severity",
						"message"
					],
					properties: {
						code: NON_EMPTY_STRING_SCHEMA,
						severity: { enum: ["info", "warning"] },
						message: NON_EMPTY_STRING_SCHEMA,
						path: NON_EMPTY_STRING_SCHEMA,
						count: SAFE_NON_NEGATIVE_INTEGER_SCHEMA
					}
				}
			},
			evidence: { $ref: "https://3dena.com/schemas/evidence-stamp.v1.json" },
			provenance: { $ref: "https://3dena.com/schemas/provenance-manifest.v1.json" }
		},
		allOf: [{ properties: { provenance: { properties: { schemaVersions: { contains: { const: ANALYSIS_TASK_VERSION_V1 } } } } } }, { properties: { provenance: { properties: { schemaVersions: { contains: { const: RESULT_ENVELOPE_VERSION_V1 } } } } } }],
		oneOf: Object.entries(RESULT_VARIANT_SCHEMAS_V1).map(([taskKind, resultSchema]) => ({
			properties: {
				taskKind: { const: taskKind },
				result: resultSchema,
				provenance: { properties: { schemaVersions: { contains: { const: RESULT_SCHEMA_VERSION_BY_TASK_KIND_V1[taskKind] } } } }
			},
			required: [
				"taskKind",
				"result",
				"provenance"
			]
		}))
	})
});
//#endregion
//#region packages/io/src/errors.ts
var Ena3dExchangeDecodeError = class extends Error {
	code;
	path;
	constructor(code, message, path) {
		super(path ? `${message} (${path})` : message);
		this.name = "Ena3dExchangeDecodeError";
		this.code = code;
		if (path !== void 0) this.path = path;
	}
};
function exchangeError(code, message, path) {
	throw new Ena3dExchangeDecodeError(code, message, path);
}
//#endregion
//#region packages/io/src/limits.ts
var DEFAULT_ENA3D_EXCHANGE_LIMITS = Object.freeze({
	maxFileBytes: 2097152,
	maxPointRows: 5e4,
	maxNodes: 50,
	maxDimensions: 200,
	maxMetadataColumns: 100,
	maxTableCells: 2e7,
	maxGroupLevels: 50,
	maxUnits: 5e4
});
var HARD_ENA3D_EXCHANGE_LIMITS = Object.freeze({
	maxFileBytes: 10485760,
	maxPointRows: 25e4,
	maxNodes: 100,
	maxDimensions: 500,
	maxMetadataColumns: 500,
	maxTableCells: 1e8,
	maxGroupLevels: 200,
	maxUnits: 25e4
});
var LIMIT_KEYS$1 = Object.freeze(Object.keys(DEFAULT_ENA3D_EXCHANGE_LIMITS));
function resolveEna3dExchangeLimits(requested) {
	if (requested !== void 0) {
		if (requested === null || typeof requested !== "object" || Array.isArray(requested)) exchangeError("INVALID_LIMIT", "Exchange limits must be an object.");
		if (Object.keys(requested).filter((key) => !LIMIT_KEYS$1.includes(key)).length > 0) exchangeError("INVALID_LIMIT", "Exchange limits contain an unsupported field.");
	}
	const resolved = { ...DEFAULT_ENA3D_EXCHANGE_LIMITS };
	for (const key of LIMIT_KEYS$1) {
		const value = requested?.[key] ?? resolved[key];
		if (!Number.isSafeInteger(value) || value < 1 || value > HARD_ENA3D_EXCHANGE_LIMITS[key]) exchangeError("INVALID_LIMIT", `Exchange limit must be a positive safe integer no greater than its hard ceiling.`, key);
		resolved[key] = value;
	}
	return Object.freeze(resolved);
}
//#endregion
//#region packages/io/src/json-preflight.ts
var JSON_WHITESPACE = /* @__PURE__ */ new Set([
	" ",
	"	",
	"\n",
	"\r"
]);
/**
* Complete, non-materializing JSON grammar scan. It runs before JSON.parse so
* duplicate keys and excessive depth cannot be normalized away by the host
* parser. Only object keys are decoded; all other values are scanned in place.
*/
function preflightJsonText(text) {
	new JsonPreflightScanner(text).scanDocument();
}
var JsonPreflightScanner = class {
	text;
	index = 0;
	constructor(text) {
		this.text = text;
	}
	scanDocument() {
		this.skipWhitespace();
		this.scanValue(0);
		this.skipWhitespace();
		if (this.index !== this.text.length) this.invalidJson();
	}
	scanValue(depth) {
		const token = this.text[this.index];
		if (token === "{") this.scanObject(depth + 1);
		else if (token === "[") this.scanArray(depth + 1);
		else if (token === "\"") this.scanString(false);
		else if (token === "t") this.scanLiteral("true");
		else if (token === "f") this.scanLiteral("false");
		else if (token === "n") this.scanLiteral("null");
		else if (token === "-" || token !== void 0 && /[0-9]/.test(token)) this.scanNumber();
		else this.invalidJson();
	}
	enterContainer(depth) {
		if (depth > 16) exchangeError("JSON_TOO_DEEP", `JSON nesting exceeds the maximum depth of 16.`);
	}
	scanObject(depth) {
		this.enterContainer(depth);
		this.index += 1;
		this.skipWhitespace();
		if (this.text[this.index] === "}") {
			this.index += 1;
			return;
		}
		const keys = /* @__PURE__ */ new Set();
		while (this.index < this.text.length) {
			if (this.text[this.index] !== "\"") this.invalidJson();
			const key = this.scanString(true);
			if (keys.has(key)) exchangeError("DUPLICATE_JSON_KEY", "A JSON object contains a duplicate key.");
			keys.add(key);
			this.skipWhitespace();
			if (this.text[this.index] !== ":") this.invalidJson();
			this.index += 1;
			this.skipWhitespace();
			this.scanValue(depth);
			this.skipWhitespace();
			const separator = this.text[this.index];
			if (separator === "}") {
				this.index += 1;
				return;
			}
			if (separator !== ",") this.invalidJson();
			this.index += 1;
			this.skipWhitespace();
		}
		this.invalidJson();
	}
	scanArray(depth) {
		this.enterContainer(depth);
		this.index += 1;
		this.skipWhitespace();
		if (this.text[this.index] === "]") {
			this.index += 1;
			return;
		}
		while (this.index < this.text.length) {
			this.scanValue(depth);
			this.skipWhitespace();
			const separator = this.text[this.index];
			if (separator === "]") {
				this.index += 1;
				return;
			}
			if (separator !== ",") this.invalidJson();
			this.index += 1;
			this.skipWhitespace();
		}
		this.invalidJson();
	}
	scanString(collect) {
		this.index += 1;
		const chunks = [];
		while (this.index < this.text.length) {
			const code = this.text.charCodeAt(this.index);
			this.index += 1;
			if (code === 34) return collect ? chunks.join("") : "";
			if (code < 32) this.invalidJson();
			if (code !== 92) {
				if (collect) chunks.push(String.fromCharCode(code));
				continue;
			}
			if (this.index >= this.text.length) this.invalidJson();
			const escaped = this.text[this.index];
			this.index += 1;
			const simple = escaped === void 0 ? void 0 : SIMPLE_ESCAPES[escaped];
			if (simple !== void 0) {
				if (collect) chunks.push(simple);
				continue;
			}
			if (escaped !== "u" || this.index + 4 > this.text.length) this.invalidJson();
			const hexadecimal = this.text.slice(this.index, this.index + 4);
			if (!/^[0-9a-fA-F]{4}$/.test(hexadecimal)) this.invalidJson();
			this.index += 4;
			if (collect) chunks.push(String.fromCharCode(Number.parseInt(hexadecimal, 16)));
		}
		this.invalidJson();
	}
	scanLiteral(expected) {
		if (this.text.slice(this.index, this.index + expected.length) !== expected) this.invalidJson();
		this.index += expected.length;
	}
	scanNumber() {
		if (this.text[this.index] === "-") this.index += 1;
		if (this.text[this.index] === "0") {
			this.index += 1;
			if (/[0-9]/.test(this.text[this.index] ?? "")) this.invalidJson();
		} else {
			if (!/[1-9]/.test(this.text[this.index] ?? "")) this.invalidJson();
			while (/[0-9]/.test(this.text[this.index] ?? "")) this.index += 1;
		}
		if (this.text[this.index] === ".") {
			this.index += 1;
			if (!/[0-9]/.test(this.text[this.index] ?? "")) this.invalidJson();
			while (/[0-9]/.test(this.text[this.index] ?? "")) this.index += 1;
		}
		if (this.text[this.index] === "e" || this.text[this.index] === "E") {
			this.index += 1;
			if (this.text[this.index] === "+" || this.text[this.index] === "-") this.index += 1;
			if (!/[0-9]/.test(this.text[this.index] ?? "")) this.invalidJson();
			while (/[0-9]/.test(this.text[this.index] ?? "")) this.index += 1;
		}
	}
	skipWhitespace() {
		while (JSON_WHITESPACE.has(this.text[this.index] ?? "")) this.index += 1;
	}
	invalidJson() {
		exchangeError("INVALID_JSON", "The JSON syntax is invalid.");
	}
};
var SIMPLE_ESCAPES = Object.freeze({
	"\"": "\"",
	"\\": "\\",
	"/": "/",
	b: "\b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "	"
});
//#endregion
//#region packages/io/src/types.ts
/** @internal Runtime marker is intentionally not re-exported by the package. */
var VALIDATED_ENA3D_EXCHANGE_V1 = Symbol("@3dena/io/validated-ena3d-exchange-v1");
//#endregion
//#region packages/io/src/decode.ts
var TOP_LEVEL_FIELDS = [
	"format",
	"version",
	"dimensions",
	"group_variables",
	"tables"
];
var TABLE_FIELDS = [
	"meta_data",
	"points",
	"line_weights",
	"nodes",
	"adjacency_key"
];
var COLUMN_TYPES = /* @__PURE__ */ new Set([
	"logical",
	"integer",
	"double",
	"character",
	"date",
	"datetime",
	"difftime",
	"factor",
	"ordered"
]);
var BASIC_COLUMN_TYPES = /* @__PURE__ */ new Set([
	"logical",
	"integer",
	"double",
	"character",
	"date"
]);
var NUMERIC_COLUMN_TYPES = /* @__PURE__ */ new Set(["integer", "double"]);
var DIFFTIME_UNITS = /* @__PURE__ */ new Set([
	"secs",
	"mins",
	"hours",
	"days",
	"weeks"
]);
var UTF8_BOM = [
	239,
	187,
	191
];
var IDENTIFIER_CONTROL = /[\u0000-\u001f\u007f]/;
var UTF8_ENCODER$3 = new TextEncoder();
var HASHED_RECEIPTS = /* @__PURE__ */ new WeakSet();
/**
* Decode and bind a SHA-256 receipt to the exact immutable byte snapshot used
* for validation. Uses browser WebCrypto and remains safe in a Web Worker.
*/
async function decodeEna3dExchangeV1WithSha256(bytes, limits) {
	const resolvedLimits = resolveEna3dExchangeLimits(limits);
	const snapshot = snapshotAndCheckBytes(bytes, resolvedLimits.maxFileBytes);
	const exchange = decodeSnapshot(snapshot, resolvedLimits);
	const sha256 = await sha256Snapshot(snapshot);
	const receipt = Object.freeze({
		exchange,
		byteLength: snapshot.byteLength,
		sha256
	});
	HASHED_RECEIPTS.add(receipt);
	return receipt;
}
/** True only for a hashed receipt issued by this module instance. */
function isHashedEna3dExchangeV1(value) {
	return typeof value === "object" && value !== null && HASHED_RECEIPTS.has(value);
}
function snapshotAndCheckBytes(bytes, maximumBytes) {
	let source;
	try {
		if (bytes instanceof ArrayBuffer) source = new Uint8Array(bytes);
		else if (ArrayBuffer.isView(bytes)) source = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		else exchangeError("INVALID_BYTES", "Exchange input must be an ArrayBuffer or ArrayBuffer view.");
	} catch {
		exchangeError("INVALID_BYTES", "Exchange input is not an accessible ArrayBuffer or ArrayBuffer view.");
	}
	if (source.byteLength === 0) exchangeError("EMPTY_INPUT", "The exchange byte input is empty.");
	if (source.byteLength > maximumBytes) exchangeError("FILE_TOO_LARGE", "The .ena3d.json byte input exceeds the configured file-size limit.");
	const snapshot = new Uint8Array(source.byteLength);
	try {
		snapshot.set(source);
	} catch {
		exchangeError("INVALID_BYTES", "Exchange input changed while its byte snapshot was being captured.");
	}
	return snapshot;
}
function decodeSnapshot(bytes, limits) {
	if (bytes.byteLength >= UTF8_BOM.length && UTF8_BOM.every((value, index) => bytes[index] === value)) exchangeError("BOM_FORBIDDEN", "UTF-8 byte-order marks are not permitted.");
	let text;
	try {
		text = new TextDecoder("utf-8", {
			fatal: true,
			ignoreBOM: true
		}).decode(bytes);
	} catch {
		exchangeError("INVALID_UTF8", "The exchange is not valid UTF-8 text.");
	}
	preflightJsonText(text);
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		exchangeError("INVALID_JSON", "The JSON syntax is invalid.");
	}
	const validated = validateExchange(parsed, limits);
	Object.defineProperty(validated, VALIDATED_ENA3D_EXCHANGE_V1, {
		value: true,
		enumerable: false,
		configurable: false,
		writable: false
	});
	return deepFreeze$5(validated);
}
function validateExchange(value, limits) {
	const root = requireObject(value, "$", TOP_LEVEL_FIELDS);
	if (root.format !== "ena3d-exchange") exchangeError("SCHEMA_MISMATCH", "format must be exactly 'ena3d-exchange'.", "$.format");
	if (root.version !== 1 || typeof root.version !== "number") exchangeError("SCHEMA_MISMATCH", "version must be the number 1.", "$.version");
	const dimensions = requireUniqueIdentifierArray(root.dimensions, "$.dimensions");
	if (dimensions.length < 3) exchangeError("SCHEMA_MISMATCH", "At least three dimensions are required.", "$.dimensions");
	enforceLimit(dimensions.length, limits.maxDimensions, "ENA dimension count", "$.dimensions");
	const groupVariables = requireUniqueIdentifierArray(root.group_variables, "$.group_variables");
	const tablesObject = requireObject(root.tables, "$.tables", TABLE_FIELDS);
	const cellBudget = { used: 0 };
	const maximumTableColumns = limits.maxMetadataColumns + limits.maxDimensions + limits.maxNodes * (limits.maxNodes - 1) / 2 + 1;
	const decodedTables = {};
	for (const tableName of TABLE_FIELDS) decodedTables[tableName] = validateTable(tablesObject[tableName], tableName, limits, maximumTableColumns, cellBudget);
	validateTableRelationships(decodedTables, dimensions, groupVariables, limits);
	return root;
}
function validateTable(value, tableName, limits, maximumColumns, cellBudget) {
	const path = `$.tables.${tableName}`;
	const tableObject = requireObject(value, path, ["columns"]);
	if (!Array.isArray(tableObject.columns) || tableObject.columns.length === 0) exchangeError("SCHEMA_MISMATCH", "A table must contain a non-empty columns array.", `${path}.columns`);
	if (tableObject.columns.length > maximumColumns) exchangeError("RESOURCE_LIMIT_EXCEEDED", "Table column count exceeds the configured structural ceiling.", `${path}.columns`);
	const columns = [];
	const names = /* @__PURE__ */ new Set();
	let rowCount;
	const rowLimit = tableName === "nodes" ? limits.maxNodes : tableName === "adjacency_key" ? 2 : limits.maxPointRows;
	for (let index = 0; index < tableObject.columns.length; index += 1) {
		const column = validateColumn(tableObject.columns[index], `${path}.columns[${index}]`, rowLimit, rowCount, limits, cellBudget);
		rowCount ??= column.values.length;
		if (names.has(column.name)) exchangeError("SCHEMA_MISMATCH", "A table contains duplicate column names.", `${path}.columns`);
		names.add(column.name);
		columns.push(column);
	}
	return {
		table: tableObject,
		rowCount: rowCount ?? 0
	};
}
function validateColumn(value, path, rowLimit, expectedRows, limits, cellBudget) {
	const column = requireObject(value, path);
	if (!("name" in column) || !("type" in column) || !("values" in column)) exchangeError("SCHEMA_MISMATCH", "A column must contain name, type, and values.", path);
	requireIdentifier(column.name, `${path}.name`);
	if (typeof column.type !== "string" || !COLUMN_TYPES.has(column.type)) exchangeError("COLUMN_TYPE_MISMATCH", "Column type is not supported by exchange v1.", `${path}.type`);
	const type = column.type;
	assertExactFields(column, BASIC_COLUMN_TYPES.has(type) ? [
		"name",
		"type",
		"values"
	] : type === "datetime" ? [
		"name",
		"type",
		"timezone",
		"values"
	] : type === "difftime" ? [
		"name",
		"type",
		"units",
		"values"
	] : [
		"name",
		"type",
		"levels",
		"values"
	], path);
	if (!Array.isArray(column.values) || column.values.length === 0) exchangeError("COLUMN_TYPE_MISMATCH", "Column values must be a non-empty array.", `${path}.values`);
	if (column.values.length > rowLimit) exchangeError("RESOURCE_LIMIT_EXCEEDED", "Table row count exceeds its configured ceiling.", `${path}.values`);
	if (expectedRows !== void 0 && column.values.length !== expectedRows) exchangeError("TABLE_ALIGNMENT_MISMATCH", "Columns in one table must have an identical non-zero row count.", `${path}.values`);
	cellBudget.used += column.values.length;
	enforceLimit(cellBudget.used, limits.maxTableCells, "total exchange table cell count", path);
	if (type === "datetime") validateTimezone(column.timezone, `${path}.timezone`);
	else if (type === "difftime") {
		if (typeof column.units !== "string" || !DIFFTIME_UNITS.has(column.units)) exchangeError("COLUMN_TYPE_MISMATCH", "difftime units are not supported by exchange v1.", `${path}.units`);
	} else if (type === "factor" || type === "ordered") validateFactorLevels(column.levels, `${path}.levels`);
	const factorLevels = type === "factor" || type === "ordered" ? new Set(column.levels) : void 0;
	for (let index = 0; index < column.values.length; index += 1) validateCell(column.values[index], type, `${path}.values[${index}]`, factorLevels);
	return column;
}
function validateCell(value, type, path, factorLevels) {
	if (value === null) return;
	if (type === "logical") {
		if (typeof value !== "boolean") cellTypeError(path);
		return;
	}
	if (type === "integer") {
		if (typeof value !== "number" || !Number.isInteger(value) || value < -2147483647 || value > 2147483647) cellTypeError(path);
		return;
	}
	if (type === "double" || type === "datetime" || type === "difftime") {
		if (typeof value !== "number" || !Number.isFinite(value)) cellTypeError(path);
		return;
	}
	if (typeof value !== "string" || !isWellFormedUnicode(value)) cellTypeError(path);
	if (type === "date" && !isIsoCalendarDate(value)) cellTypeError(path);
	if ((type === "factor" || type === "ordered") && !factorLevels?.has(value)) cellTypeError(path);
}
function validateTableRelationships(tables, dimensions, groupVariables, limits) {
	const metadataColumns = tables.meta_data.table.columns;
	const pointColumns = tables.points.table.columns;
	const weightColumns = tables.line_weights.table.columns;
	const nodeColumns = tables.nodes.table.columns;
	const adjacencyColumns = tables.adjacency_key.table.columns;
	const metadataNames = metadataColumns.map(({ name }) => name);
	enforceLimit(metadataColumns.length, limits.maxMetadataColumns, "metadata column count", "$.tables.meta_data.columns");
	if (!metadataNames.includes("ENA_UNIT")) exchangeError("TABLE_ALIGNMENT_MISMATCH", "meta_data must contain ENA_UNIT.", "$.tables.meta_data.columns");
	if (!groupVariables.every((name) => metadataNames.includes(name))) exchangeError("TABLE_ALIGNMENT_MISMATCH", "Every group variable must name a metadata column.", "$.group_variables");
	assertColumnOrder(pointColumns, [...metadataNames, ...dimensions], "Points must contain metadata followed by dimensions in declared order.", "$.tables.points.columns");
	assertColumnOrder(nodeColumns, ["code", ...dimensions], "Nodes must contain code followed by dimensions in declared order.", "$.tables.nodes.columns");
	if (tables.meta_data.rowCount !== tables.points.rowCount || tables.meta_data.rowCount !== tables.line_weights.rowCount) exchangeError("TABLE_ALIGNMENT_MISMATCH", "meta_data, points, and line_weights must have identical row counts.", "$.tables");
	if (tables.adjacency_key.rowCount !== 2) exchangeError("ADJACENCY_MISMATCH", "adjacency_key must have exactly two rows.", "$.tables.adjacency_key");
	for (let index = 0; index < metadataColumns.length; index += 1) {
		const metadata = metadataColumns[index];
		const point = pointColumns[index];
		const weight = weightColumns[index];
		if (metadata === void 0 || point === void 0 || weight === void 0 || !columnsEqual(metadata, point) || !columnsEqual(metadata, weight)) exchangeError("METADATA_ALIGNMENT_MISMATCH", "Metadata type, attributes, and values must align across all row tables.", `$.tables.meta_data.columns[${index}]`);
	}
	const dimensionOffset = metadataColumns.length;
	for (let index = 0; index < dimensions.length; index += 1) {
		const pointDimension = pointColumns[dimensionOffset + index];
		const nodeDimension = nodeColumns[index + 1];
		if (pointDimension === void 0 || nodeDimension === void 0 || !NUMERIC_COLUMN_TYPES.has(pointDimension.type) || !NUMERIC_COLUMN_TYPES.has(nodeDimension.type)) exchangeError("COLUMN_TYPE_MISMATCH", "Point and node dimensions must be numeric columns.", "$.tables");
		requireCompleteFiniteColumn(nodeDimension, "Node dimensions must be complete finite numbers.", `$.tables.nodes.columns[${index + 1}]`);
	}
	const codeColumn = nodeColumns[0];
	if (codeColumn?.type !== "character") exchangeError("COLUMN_TYPE_MISMATCH", "nodes.code must be a character column.", "$.tables.nodes.columns[0]");
	validateAdjacencyAndWeights(requireNodeCodes(codeColumn), adjacencyColumns, weightColumns, metadataNames);
	validateIdentityResourceCeilings(metadataColumns, groupVariables, limits);
}
function validateAdjacencyAndWeights(nodeCodes, adjacencyColumns, weightColumns, metadataNames) {
	const expectedEdges = nodeCodes.length * (nodeCodes.length - 1) / 2;
	if (adjacencyColumns.length !== expectedEdges) exchangeError("ADJACENCY_MISMATCH", "Adjacency must contain exactly one edge for every unordered node pair.", "$.tables.adjacency_key.columns");
	const nodeIndex = new Map(nodeCodes.map((code, index) => [code, index]));
	const seenPairs = /* @__PURE__ */ new Set();
	const edgeNames = [];
	for (let index = 0; index < adjacencyColumns.length; index += 1) {
		const edge = adjacencyColumns[index];
		if (edge?.type !== "character" || edge.values.length !== 2) exchangeError("ADJACENCY_MISMATCH", "Every adjacency column must contain two character endpoints.", `$.tables.adjacency_key.columns[${index}]`);
		const from = edge.values[0];
		const to = edge.values[1];
		if (typeof from !== "string" || typeof to !== "string" || from.length === 0 || to.length === 0 || !nodeIndex.has(from) || !nodeIndex.has(to) || from === to) exchangeError("ADJACENCY_MISMATCH", "Adjacency endpoints must be distinct, known, non-empty node codes.", `$.tables.adjacency_key.columns[${index}]`);
		if (edge.name !== `${from} & ${to}`) exchangeError("ADJACENCY_MISMATCH", "Adjacency column names must preserve '<from> & <to>' endpoint order.", `$.tables.adjacency_key.columns[${index}].name`);
		const left = nodeIndex.get(from);
		const right = nodeIndex.get(to);
		if (left === void 0 || right === void 0) exchangeError("ADJACENCY_MISMATCH", "Adjacency endpoint is unknown.");
		const pair = left < right ? `${left}:${right}` : `${right}:${left}`;
		if (seenPairs.has(pair)) exchangeError("ADJACENCY_MISMATCH", "Adjacency contains a duplicate unordered node pair.", "$.tables.adjacency_key.columns");
		seenPairs.add(pair);
		edgeNames.push(edge.name);
	}
	for (let left = 0; left < nodeCodes.length; left += 1) for (let right = left + 1; right < nodeCodes.length; right += 1) if (!seenPairs.has(`${left}:${right}`)) exchangeError("ADJACENCY_MISMATCH", "Adjacency does not contain every unordered node pair.", "$.tables.adjacency_key.columns");
	assertColumnOrder(weightColumns, [...metadataNames, ...edgeNames], "Line weights must contain metadata followed by adjacency edges in exact order.", "$.tables.line_weights.columns");
	for (let index = metadataNames.length; index < weightColumns.length; index += 1) {
		const edge = weightColumns[index];
		if (edge === void 0 || !NUMERIC_COLUMN_TYPES.has(edge.type)) exchangeError("COLUMN_TYPE_MISMATCH", "Line-weight edge columns must be numeric.", `$.tables.line_weights.columns[${index}]`);
		requireCompleteFiniteColumn(edge, "Line-weight edges must be complete finite numbers.", `$.tables.line_weights.columns[${index}]`);
	}
}
function validateIdentityResourceCeilings(metadataColumns, groupVariables, limits) {
	const byName = new Map(metadataColumns.map((column) => [column.name, column]));
	for (let index = 0; index < groupVariables.length; index += 1) {
		const column = byName.get(groupVariables[index] ?? "");
		if (column === void 0) continue;
		for (const value of column.values) if (value === null || typeof value === "string" && value.trim() === "") exchangeError("TABLE_ALIGNMENT_MISMATCH", "Grouping columns must not contain missing or blank values.", `$.group_variables[${index}]`);
		enforceLimit(countUniqueScalars(column.values), limits.maxGroupLevels, "grouping-column level count", `$.group_variables[${index}]`);
	}
	const unitColumn = byName.get("ENA_UNIT");
	if (unitColumn !== void 0) enforceLimit(countUniqueScalars(unitColumn.values), limits.maxUnits, "unique ENA unit count", "$.tables.meta_data");
}
function requireNodeCodes(column) {
	const codes = [];
	const seen = /* @__PURE__ */ new Set();
	for (let index = 0; index < column.values.length; index += 1) {
		const value = column.values[index];
		if (typeof value !== "string" || value.length === 0 || seen.has(value)) exchangeError("ADJACENCY_MISMATCH", "Node codes must be non-missing, non-empty, and unique.", `$.tables.nodes.columns[0].values[${index}]`);
		seen.add(value);
		codes.push(value);
	}
	return codes;
}
function requireCompleteFiniteColumn(column, message, path) {
	if (column.values.some((value) => value === null || typeof value !== "number" || !Number.isFinite(value))) exchangeError("COLUMN_TYPE_MISMATCH", message, path);
}
function columnsEqual(left, right) {
	if (left.name !== right.name || left.type !== right.type) return false;
	if (left.type === "datetime" && right.type === "datetime") {
		if (left.timezone !== right.timezone) return false;
	} else if (left.type === "difftime" && right.type === "difftime") {
		if (left.units !== right.units) return false;
	} else if ((left.type === "factor" || left.type === "ordered") && (right.type === "factor" || right.type === "ordered")) {
		if (!arraysEqual(left.levels, right.levels)) return false;
	}
	return arraysEqual(left.values, right.values);
}
function assertColumnOrder(columns, expected, message, path) {
	if (columns.length !== expected.length || columns.some((column, index) => column.name !== expected[index])) exchangeError("TABLE_ALIGNMENT_MISMATCH", message, path);
}
function requireUniqueIdentifierArray(value, path) {
	if (!Array.isArray(value) || value.length === 0) exchangeError("SCHEMA_MISMATCH", "Expected a non-empty array of identifiers.", path);
	const result = [];
	const seen = /* @__PURE__ */ new Set();
	for (let index = 0; index < value.length; index += 1) {
		const item = requireIdentifier(value[index], `${path}[${index}]`);
		if (seen.has(item)) exchangeError("SCHEMA_MISMATCH", "Identifier array contains duplicates.", path);
		seen.add(item);
		result.push(item);
	}
	return result;
}
function requireIdentifier(value, path) {
	if (typeof value !== "string" || !isWellFormedUnicode(value) || UTF8_ENCODER$3.encode(value).byteLength < 1 || UTF8_ENCODER$3.encode(value).byteLength > 256 || IDENTIFIER_CONTROL.test(value)) exchangeError("SCHEMA_MISMATCH", "Identifier must be 1-256 UTF-8 bytes without control characters.", path);
	return value;
}
function validateFactorLevels(value, path) {
	if (!Array.isArray(value) || value.length === 0) exchangeError("COLUMN_TYPE_MISMATCH", "Factor levels must be a non-empty array.", path);
	const seen = /* @__PURE__ */ new Set();
	for (let index = 0; index < value.length; index += 1) {
		const level = value[index];
		if (typeof level !== "string" || !isWellFormedUnicode(level) || seen.has(level)) exchangeError("COLUMN_TYPE_MISMATCH", "Factor levels must be unique well-formed strings.", `${path}[${index}]`);
		seen.add(level);
	}
}
function validateTimezone(value, path) {
	if (typeof value !== "string" || !isWellFormedUnicode(value) || value.length === 0 || UTF8_ENCODER$3.encode(value).byteLength > 128) exchangeError("COLUMN_TYPE_MISMATCH", "Timezone is invalid.", path);
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
	} catch {
		exchangeError("COLUMN_TYPE_MISMATCH", "Timezone must be UTC or an installed IANA timezone.", path);
	}
}
function requireObject(value, path, fields) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) exchangeError("SCHEMA_MISMATCH", "Expected a JSON object.", path);
	const object = value;
	if (fields !== void 0) assertExactFields(object, fields, path);
	return object;
}
function assertExactFields(object, fields, path) {
	const keys = Object.keys(object);
	if (keys.length !== fields.length || fields.some((field) => !Object.hasOwn(object, field)) || keys.some((key) => !fields.includes(key))) exchangeError("SCHEMA_MISMATCH", "JSON object fields do not exactly match exchange v1.", path);
}
function enforceLimit(actual, maximum, label, path) {
	if (!Number.isSafeInteger(actual) || actual > maximum) exchangeError("RESOURCE_LIMIT_EXCEEDED", `${label} exceeds the configured ceiling.`, path);
}
function countUniqueScalars(values) {
	return new Set(values.map((value) => value === null ? "null" : `${typeof value}:${String(value)}`)).size;
}
function arraysEqual(left, right) {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}
function cellTypeError(path) {
	exchangeError("COLUMN_TYPE_MISMATCH", "Cell value does not match its declared exchange column type.", path);
}
function isIsoCalendarDate(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (match === null) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12 || day < 1) return false;
	return day <= ([
		31,
		year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31
	][month - 1] ?? 0);
}
function isWellFormedUnicode(value) {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 55296 && code <= 56319) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 56320 && next <= 57343)) return false;
			index += 1;
		} else if (code >= 56320 && code <= 57343) return false;
	}
	return true;
}
function deepFreeze$5(value) {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze$5(nested);
		Object.freeze(value);
	}
	return value;
}
async function sha256Snapshot(bytes) {
	const subtle = globalThis.crypto?.subtle;
	if (subtle === void 0) exchangeError("CRYPTO_UNAVAILABLE", "WebCrypto SubtleCrypto is unavailable in this runtime.");
	const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
	return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}
//#endregion
//#region node_modules/xlsx/xlsx.mjs
/*! xlsx.js (C) 2013-present SheetJS -- http://sheetjs.com */
var XLSX = {};
XLSX.version = "0.20.3";
var $cptable;
function set_cptable(cptable) {
	$cptable = cptable;
}
var has_buf$1 = /*#__PURE__*/ (function() {
	return typeof Buffer !== "undefined" && typeof process !== "undefined" && typeof process.versions !== "undefined" && !!process.versions.node;
})();
(/* @__PURE__ */ new Date("6/9/69 00:00 UTC")).valueOf();
if (has_buf$1) {}
if (typeof $cptable !== "undefined");
/*! sheetjs (C) 2013-present SheetJS -- http://sheetjs.com */
(function() {
	try {
		if (typeof Uint8Array == "undefined") return "slice";
		if (typeof Uint8Array.prototype.subarray == "undefined") return "slice";
		if (typeof Buffer !== "undefined") {
			if (typeof Buffer.prototype.subarray == "undefined") return "slice";
			if ((typeof Buffer.from == "function" ? Buffer.from([72, 62]) : new Buffer([72, 62])) instanceof Uint8Array) return "subarray";
			return "slice";
		}
		return "subarray";
	} catch (e) {
		return "slice";
	}
})();
XLSX.version;
//#endregion
//#region node_modules/xlsx/dist/cpexcel.full.mjs
var cpexcel_full_exports = /* @__PURE__ */ __exportAll({
	cptable: () => cptable,
	utils: () => utils,
	version: () => version
});
/*! cpexcel.mjs (C) 2013-present SheetJS -- http://sheetjs.com */
var version = "1.15.0";
var cptable = {};
cptable[437] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[620] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÇüéâäàąçêëèïîćÄĄĘęłôöĆûùŚÖÜ¢Ł¥śƒŹŻóÓńŃźż¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[737] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρσςτυφχψ░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀ωάέήϊίόύϋώΆΈΉΊΌΎΏ±≥≤ΪΫ÷≈°∙·√ⁿ²■\xA0", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[850] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■\xA0", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[852] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÇüéâäůćçłëŐőîŹÄĆÉĹĺôöĽľŚśÖÜŤťŁ×čáíóúĄąŽžĘę¬źČş«»░▒▓│┤ÁÂĚŞ╣║╗╝Żż┐└┴┬├─┼Ăă╚╔╩╦╠═╬¤đĐĎËďŇÍÎě┘┌█▄ŢŮ▀ÓßÔŃńňŠšŔÚŕŰýÝţ´­˝˛ˇ˘§÷¸°¨˙űŘř■\xA0", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[857] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÇüéâäàåçêëèïîıÄÅÉæÆôöòûùİÖÜø£ØŞşáíóúñÑĞğ¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ºªÊËÈ�ÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµ�×ÚÛÙìÿ¯´­±�¾¶§÷¸°¨·¹³²■\xA0", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[861] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÇüéâäàåçêëèÐðÞÄÅÉæÆôöþûÝýÖÜø£Ø₧ƒáíóúÁÍÓÚ¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[865] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø₧ƒáíóúñÑªº¿⌐¬½¼¡«¤░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[866] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■\xA0", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[874] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€����…�����������‘’“”•–—��������\xA0กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮฯะัาำิีึืฺุู����฿เแโใไๅๆ็่้๊๋์ํ๎๏๐๑๒๓๔๕๖๗๘๙๚๛����", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[895] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ČüéďäĎŤčěĚĹÍľǪÄÁÉžŽôöÓůÚýÖÜŠĽÝŘťáíóúňŇŮÔšřŕŔ¼§«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\xA0", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[932] = (function() {
	var d = [], e = {}, D = [], j;
	D[0] = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~���������������������������������｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ��������������������������������".split("");
	for (j = 0; j != D[0].length; ++j) if (D[0][j].charCodeAt(0) !== 65533) {
		e[D[0][j]] = 0 + j;
		d[0 + j] = D[0][j];
	}
	D[129] = "����������������������������������������������������������������　、。，．・：；？！゛゜´｀¨＾￣＿ヽヾゝゞ〃仝々〆〇ー―‐／＼～∥｜…‥‘’“”（）〔〕［］｛｝〈〉《》「」『』【】＋－±×�÷＝≠＜＞≦≧∞∴♂♀°′″℃￥＄￠￡％＃＆＊＠§☆★○●◎◇◆□■△▲▽▼※〒→←↑↓〓�����������∈∋⊆⊇⊂⊃∪∩��������∧∨￢⇒⇔∀∃�����������∠⊥⌒∂∇≡≒≪≫√∽∝∵∫∬�������Å‰♯♭♪†‡¶����◯���".split("");
	for (j = 0; j != D[129].length; ++j) if (D[129][j].charCodeAt(0) !== 65533) {
		e[D[129][j]] = 33024 + j;
		d[33024 + j] = D[129][j];
	}
	D[130] = "�������������������������������������������������������������������������������０１２３４５６７８９�������ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ�������ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ����ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをん��������������".split("");
	for (j = 0; j != D[130].length; ++j) if (D[130][j].charCodeAt(0) !== 65533) {
		e[D[130][j]] = 33280 + j;
		d[33280 + j] = D[130][j];
	}
	D[131] = "����������������������������������������������������������������ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミ�ムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ��������ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ��������αβγδεζηθικλμνξοπρστυφχψω�����������������������������������������".split("");
	for (j = 0; j != D[131].length; ++j) if (D[131][j].charCodeAt(0) !== 65533) {
		e[D[131][j]] = 33536 + j;
		d[33536 + j] = D[131][j];
	}
	D[132] = "����������������������������������������������������������������АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ���������������абвгдеёжзийклмн�опрстуфхцчшщъыьэюя�������������─│┌┐┘└├┬┤┴┼━┃┏┓┛┗┣┳┫┻╋┠┯┨┷┿┝┰┥┸╂�����������������������������������������������������������������".split("");
	for (j = 0; j != D[132].length; ++j) if (D[132][j].charCodeAt(0) !== 65533) {
		e[D[132][j]] = 33792 + j;
		d[33792 + j] = D[132][j];
	}
	D[135] = "����������������������������������������������������������������①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ�㍉㌔㌢㍍㌘㌧㌃㌶㍑㍗㌍㌦㌣㌫㍊㌻㎜㎝㎞㎎㎏㏄㎡��������㍻�〝〟№㏍℡㊤㊥㊦㊧㊨㈱㈲㈹㍾㍽㍼≒≡∫∮∑√⊥∠∟⊿∵∩∪���������������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[135].length; ++j) if (D[135][j].charCodeAt(0) !== 65533) {
		e[D[135][j]] = 34560 + j;
		d[34560 + j] = D[135][j];
	}
	D[136] = "���������������������������������������������������������������������������������������������������������������������������������������������������������������亜唖娃阿哀愛挨姶逢葵茜穐悪握渥旭葦芦鯵梓圧斡扱宛姐虻飴絢綾鮎或粟袷安庵按暗案闇鞍杏以伊位依偉囲夷委威尉惟意慰易椅為畏異移維緯胃萎衣謂違遺医井亥域育郁磯一壱溢逸稲茨芋鰯允印咽員因姻引飲淫胤蔭���".split("");
	for (j = 0; j != D[136].length; ++j) if (D[136][j].charCodeAt(0) !== 65533) {
		e[D[136][j]] = 34816 + j;
		d[34816 + j] = D[136][j];
	}
	D[137] = "����������������������������������������������������������������院陰隠韻吋右宇烏羽迂雨卯鵜窺丑碓臼渦嘘唄欝蔚鰻姥厩浦瓜閏噂云運雲荏餌叡営嬰影映曳栄永泳洩瑛盈穎頴英衛詠鋭液疫益駅悦謁越閲榎厭円�園堰奄宴延怨掩援沿演炎焔煙燕猿縁艶苑薗遠鉛鴛塩於汚甥凹央奥往応押旺横欧殴王翁襖鴬鴎黄岡沖荻億屋憶臆桶牡乙俺卸恩温穏音下化仮何伽価佳加可嘉夏嫁家寡科暇果架歌河火珂禍禾稼箇花苛茄荷華菓蝦課嘩貨迦過霞蚊俄峨我牙画臥芽蛾賀雅餓駕介会解回塊壊廻快怪悔恢懐戒拐改���".split("");
	for (j = 0; j != D[137].length; ++j) if (D[137][j].charCodeAt(0) !== 65533) {
		e[D[137][j]] = 35072 + j;
		d[35072 + j] = D[137][j];
	}
	D[138] = "����������������������������������������������������������������魁晦械海灰界皆絵芥蟹開階貝凱劾外咳害崖慨概涯碍蓋街該鎧骸浬馨蛙垣柿蛎鈎劃嚇各廓拡撹格核殻獲確穫覚角赫較郭閣隔革学岳楽額顎掛笠樫�橿梶鰍潟割喝恰括活渇滑葛褐轄且鰹叶椛樺鞄株兜竃蒲釜鎌噛鴨栢茅萱粥刈苅瓦乾侃冠寒刊勘勧巻喚堪姦完官寛干幹患感慣憾換敢柑桓棺款歓汗漢澗潅環甘監看竿管簡緩缶翰肝艦莞観諌貫還鑑間閑関陥韓館舘丸含岸巌玩癌眼岩翫贋雁頑顔願企伎危喜器基奇嬉寄岐希幾忌揮机旗既期棋棄���".split("");
	for (j = 0; j != D[138].length; ++j) if (D[138][j].charCodeAt(0) !== 65533) {
		e[D[138][j]] = 35328 + j;
		d[35328 + j] = D[138][j];
	}
	D[139] = "����������������������������������������������������������������機帰毅気汽畿祈季稀紀徽規記貴起軌輝飢騎鬼亀偽儀妓宜戯技擬欺犠疑祇義蟻誼議掬菊鞠吉吃喫桔橘詰砧杵黍却客脚虐逆丘久仇休及吸宮弓急救�朽求汲泣灸球究窮笈級糾給旧牛去居巨拒拠挙渠虚許距鋸漁禦魚亨享京供侠僑兇競共凶協匡卿叫喬境峡強彊怯恐恭挟教橋況狂狭矯胸脅興蕎郷鏡響饗驚仰凝尭暁業局曲極玉桐粁僅勤均巾錦斤欣欽琴禁禽筋緊芹菌衿襟謹近金吟銀九倶句区狗玖矩苦躯駆駈駒具愚虞喰空偶寓遇隅串櫛釧屑屈���".split("");
	for (j = 0; j != D[139].length; ++j) if (D[139][j].charCodeAt(0) !== 65533) {
		e[D[139][j]] = 35584 + j;
		d[35584 + j] = D[139][j];
	}
	D[140] = "����������������������������������������������������������������掘窟沓靴轡窪熊隈粂栗繰桑鍬勲君薫訓群軍郡卦袈祁係傾刑兄啓圭珪型契形径恵慶慧憩掲携敬景桂渓畦稽系経継繋罫茎荊蛍計詣警軽頚鶏芸迎鯨�劇戟撃激隙桁傑欠決潔穴結血訣月件倹倦健兼券剣喧圏堅嫌建憲懸拳捲検権牽犬献研硯絹県肩見謙賢軒遣鍵険顕験鹸元原厳幻弦減源玄現絃舷言諺限乎個古呼固姑孤己庫弧戸故枯湖狐糊袴股胡菰虎誇跨鈷雇顧鼓五互伍午呉吾娯後御悟梧檎瑚碁語誤護醐乞鯉交佼侯候倖光公功効勾厚口向���".split("");
	for (j = 0; j != D[140].length; ++j) if (D[140][j].charCodeAt(0) !== 65533) {
		e[D[140][j]] = 35840 + j;
		d[35840 + j] = D[140][j];
	}
	D[141] = "����������������������������������������������������������������后喉坑垢好孔孝宏工巧巷幸広庚康弘恒慌抗拘控攻昂晃更杭校梗構江洪浩港溝甲皇硬稿糠紅紘絞綱耕考肯肱腔膏航荒行衡講貢購郊酵鉱砿鋼閤降�項香高鴻剛劫号合壕拷濠豪轟麹克刻告国穀酷鵠黒獄漉腰甑忽惚骨狛込此頃今困坤墾婚恨懇昏昆根梱混痕紺艮魂些佐叉唆嵯左差査沙瑳砂詐鎖裟坐座挫債催再最哉塞妻宰彩才採栽歳済災采犀砕砦祭斎細菜裁載際剤在材罪財冴坂阪堺榊肴咲崎埼碕鷺作削咋搾昨朔柵窄策索錯桜鮭笹匙冊刷���".split("");
	for (j = 0; j != D[141].length; ++j) if (D[141][j].charCodeAt(0) !== 65533) {
		e[D[141][j]] = 36096 + j;
		d[36096 + j] = D[141][j];
	}
	D[142] = "����������������������������������������������������������������察拶撮擦札殺薩雑皐鯖捌錆鮫皿晒三傘参山惨撒散桟燦珊産算纂蚕讃賛酸餐斬暫残仕仔伺使刺司史嗣四士始姉姿子屍市師志思指支孜斯施旨枝止�死氏獅祉私糸紙紫肢脂至視詞詩試誌諮資賜雌飼歯事似侍児字寺慈持時次滋治爾璽痔磁示而耳自蒔辞汐鹿式識鴫竺軸宍雫七叱執失嫉室悉湿漆疾質実蔀篠偲柴芝屡蕊縞舎写射捨赦斜煮社紗者謝車遮蛇邪借勺尺杓灼爵酌釈錫若寂弱惹主取守手朱殊狩珠種腫趣酒首儒受呪寿授樹綬需囚収周���".split("");
	for (j = 0; j != D[142].length; ++j) if (D[142][j].charCodeAt(0) !== 65533) {
		e[D[142][j]] = 36352 + j;
		d[36352 + j] = D[142][j];
	}
	D[143] = "����������������������������������������������������������������宗就州修愁拾洲秀秋終繍習臭舟蒐衆襲讐蹴輯週酋酬集醜什住充十従戎柔汁渋獣縦重銃叔夙宿淑祝縮粛塾熟出術述俊峻春瞬竣舜駿准循旬楯殉淳�準潤盾純巡遵醇順処初所暑曙渚庶緒署書薯藷諸助叙女序徐恕鋤除傷償勝匠升召哨商唱嘗奨妾娼宵将小少尚庄床廠彰承抄招掌捷昇昌昭晶松梢樟樵沼消渉湘焼焦照症省硝礁祥称章笑粧紹肖菖蒋蕉衝裳訟証詔詳象賞醤鉦鍾鐘障鞘上丈丞乗冗剰城場壌嬢常情擾条杖浄状畳穣蒸譲醸錠嘱埴飾���".split("");
	for (j = 0; j != D[143].length; ++j) if (D[143][j].charCodeAt(0) !== 65533) {
		e[D[143][j]] = 36608 + j;
		d[36608 + j] = D[143][j];
	}
	D[144] = "����������������������������������������������������������������拭植殖燭織職色触食蝕辱尻伸信侵唇娠寝審心慎振新晋森榛浸深申疹真神秦紳臣芯薪親診身辛進針震人仁刃塵壬尋甚尽腎訊迅陣靭笥諏須酢図厨�逗吹垂帥推水炊睡粋翠衰遂酔錐錘随瑞髄崇嵩数枢趨雛据杉椙菅頗雀裾澄摺寸世瀬畝是凄制勢姓征性成政整星晴棲栖正清牲生盛精聖声製西誠誓請逝醒青静斉税脆隻席惜戚斥昔析石積籍績脊責赤跡蹟碩切拙接摂折設窃節説雪絶舌蝉仙先千占宣専尖川戦扇撰栓栴泉浅洗染潜煎煽旋穿箭線���".split("");
	for (j = 0; j != D[144].length; ++j) if (D[144][j].charCodeAt(0) !== 65533) {
		e[D[144][j]] = 36864 + j;
		d[36864 + j] = D[144][j];
	}
	D[145] = "����������������������������������������������������������������繊羨腺舛船薦詮賎践選遷銭銑閃鮮前善漸然全禅繕膳糎噌塑岨措曾曽楚狙疏疎礎祖租粗素組蘇訴阻遡鼠僧創双叢倉喪壮奏爽宋層匝惣想捜掃挿掻�操早曹巣槍槽漕燥争痩相窓糟総綜聡草荘葬蒼藻装走送遭鎗霜騒像増憎臓蔵贈造促側則即息捉束測足速俗属賊族続卒袖其揃存孫尊損村遜他多太汰詑唾堕妥惰打柁舵楕陀駄騨体堆対耐岱帯待怠態戴替泰滞胎腿苔袋貸退逮隊黛鯛代台大第醍題鷹滝瀧卓啄宅托択拓沢濯琢託鐸濁諾茸凧蛸只���".split("");
	for (j = 0; j != D[145].length; ++j) if (D[145][j].charCodeAt(0) !== 65533) {
		e[D[145][j]] = 37120 + j;
		d[37120 + j] = D[145][j];
	}
	D[146] = "����������������������������������������������������������������叩但達辰奪脱巽竪辿棚谷狸鱈樽誰丹単嘆坦担探旦歎淡湛炭短端箪綻耽胆蛋誕鍛団壇弾断暖檀段男談値知地弛恥智池痴稚置致蜘遅馳築畜竹筑蓄�逐秩窒茶嫡着中仲宙忠抽昼柱注虫衷註酎鋳駐樗瀦猪苧著貯丁兆凋喋寵帖帳庁弔張彫徴懲挑暢朝潮牒町眺聴脹腸蝶調諜超跳銚長頂鳥勅捗直朕沈珍賃鎮陳津墜椎槌追鎚痛通塚栂掴槻佃漬柘辻蔦綴鍔椿潰坪壷嬬紬爪吊釣鶴亭低停偵剃貞呈堤定帝底庭廷弟悌抵挺提梯汀碇禎程締艇訂諦蹄逓���".split("");
	for (j = 0; j != D[146].length; ++j) if (D[146][j].charCodeAt(0) !== 65533) {
		e[D[146][j]] = 37376 + j;
		d[37376 + j] = D[146][j];
	}
	D[147] = "����������������������������������������������������������������邸鄭釘鼎泥摘擢敵滴的笛適鏑溺哲徹撤轍迭鉄典填天展店添纏甜貼転顛点伝殿澱田電兎吐堵塗妬屠徒斗杜渡登菟賭途都鍍砥砺努度土奴怒倒党冬�凍刀唐塔塘套宕島嶋悼投搭東桃梼棟盗淘湯涛灯燈当痘祷等答筒糖統到董蕩藤討謄豆踏逃透鐙陶頭騰闘働動同堂導憧撞洞瞳童胴萄道銅峠鴇匿得徳涜特督禿篤毒独読栃橡凸突椴届鳶苫寅酉瀞噸屯惇敦沌豚遁頓呑曇鈍奈那内乍凪薙謎灘捺鍋楢馴縄畷南楠軟難汝二尼弐迩匂賑肉虹廿日乳入���".split("");
	for (j = 0; j != D[147].length; ++j) if (D[147][j].charCodeAt(0) !== 65533) {
		e[D[147][j]] = 37632 + j;
		d[37632 + j] = D[147][j];
	}
	D[148] = "����������������������������������������������������������������如尿韮任妊忍認濡禰祢寧葱猫熱年念捻撚燃粘乃廼之埜嚢悩濃納能脳膿農覗蚤巴把播覇杷波派琶破婆罵芭馬俳廃拝排敗杯盃牌背肺輩配倍培媒梅�楳煤狽買売賠陪這蝿秤矧萩伯剥博拍柏泊白箔粕舶薄迫曝漠爆縛莫駁麦函箱硲箸肇筈櫨幡肌畑畠八鉢溌発醗髪伐罰抜筏閥鳩噺塙蛤隼伴判半反叛帆搬斑板氾汎版犯班畔繁般藩販範釆煩頒飯挽晩番盤磐蕃蛮匪卑否妃庇彼悲扉批披斐比泌疲皮碑秘緋罷肥被誹費避非飛樋簸備尾微枇毘琵眉美���".split("");
	for (j = 0; j != D[148].length; ++j) if (D[148][j].charCodeAt(0) !== 65533) {
		e[D[148][j]] = 37888 + j;
		d[37888 + j] = D[148][j];
	}
	D[149] = "����������������������������������������������������������������鼻柊稗匹疋髭彦膝菱肘弼必畢筆逼桧姫媛紐百謬俵彪標氷漂瓢票表評豹廟描病秒苗錨鋲蒜蛭鰭品彬斌浜瀕貧賓頻敏瓶不付埠夫婦富冨布府怖扶敷�斧普浮父符腐膚芙譜負賦赴阜附侮撫武舞葡蕪部封楓風葺蕗伏副復幅服福腹複覆淵弗払沸仏物鮒分吻噴墳憤扮焚奮粉糞紛雰文聞丙併兵塀幣平弊柄並蔽閉陛米頁僻壁癖碧別瞥蔑箆偏変片篇編辺返遍便勉娩弁鞭保舗鋪圃捕歩甫補輔穂募墓慕戊暮母簿菩倣俸包呆報奉宝峰峯崩庖抱捧放方朋���".split("");
	for (j = 0; j != D[149].length; ++j) if (D[149][j].charCodeAt(0) !== 65533) {
		e[D[149][j]] = 38144 + j;
		d[38144 + j] = D[149][j];
	}
	D[150] = "����������������������������������������������������������������法泡烹砲縫胞芳萌蓬蜂褒訪豊邦鋒飽鳳鵬乏亡傍剖坊妨帽忘忙房暴望某棒冒紡肪膨謀貌貿鉾防吠頬北僕卜墨撲朴牧睦穆釦勃没殆堀幌奔本翻凡盆�摩磨魔麻埋妹昧枚毎哩槙幕膜枕鮪柾鱒桝亦俣又抹末沫迄侭繭麿万慢満漫蔓味未魅巳箕岬密蜜湊蓑稔脈妙粍民眠務夢無牟矛霧鵡椋婿娘冥名命明盟迷銘鳴姪牝滅免棉綿緬面麺摸模茂妄孟毛猛盲網耗蒙儲木黙目杢勿餅尤戻籾貰問悶紋門匁也冶夜爺耶野弥矢厄役約薬訳躍靖柳薮鑓愉愈油癒���".split("");
	for (j = 0; j != D[150].length; ++j) if (D[150][j].charCodeAt(0) !== 65533) {
		e[D[150][j]] = 38400 + j;
		d[38400 + j] = D[150][j];
	}
	D[151] = "����������������������������������������������������������������諭輸唯佑優勇友宥幽悠憂揖有柚湧涌猶猷由祐裕誘遊邑郵雄融夕予余与誉輿預傭幼妖容庸揚揺擁曜楊様洋溶熔用窯羊耀葉蓉要謡踊遥陽養慾抑欲�沃浴翌翼淀羅螺裸来莱頼雷洛絡落酪乱卵嵐欄濫藍蘭覧利吏履李梨理璃痢裏裡里離陸律率立葎掠略劉流溜琉留硫粒隆竜龍侶慮旅虜了亮僚両凌寮料梁涼猟療瞭稜糧良諒遼量陵領力緑倫厘林淋燐琳臨輪隣鱗麟瑠塁涙累類令伶例冷励嶺怜玲礼苓鈴隷零霊麗齢暦歴列劣烈裂廉恋憐漣煉簾練聯���".split("");
	for (j = 0; j != D[151].length; ++j) if (D[151][j].charCodeAt(0) !== 65533) {
		e[D[151][j]] = 38656 + j;
		d[38656 + j] = D[151][j];
	}
	D[152] = "����������������������������������������������������������������蓮連錬呂魯櫓炉賂路露労婁廊弄朗楼榔浪漏牢狼篭老聾蝋郎六麓禄肋録論倭和話歪賄脇惑枠鷲亙亘鰐詫藁蕨椀湾碗腕��������������������������������������������弌丐丕个丱丶丼丿乂乖乘亂亅豫亊舒弍于亞亟亠亢亰亳亶从仍仄仆仂仗仞仭仟价伉佚估佛佝佗佇佶侈侏侘佻佩佰侑佯來侖儘俔俟俎俘俛俑俚俐俤俥倚倨倔倪倥倅伜俶倡倩倬俾俯們倆偃假會偕偐偈做偖偬偸傀傚傅傴傲���".split("");
	for (j = 0; j != D[152].length; ++j) if (D[152][j].charCodeAt(0) !== 65533) {
		e[D[152][j]] = 38912 + j;
		d[38912 + j] = D[152][j];
	}
	D[153] = "����������������������������������������������������������������僉僊傳僂僖僞僥僭僣僮價僵儉儁儂儖儕儔儚儡儺儷儼儻儿兀兒兌兔兢竸兩兪兮冀冂囘册冉冏冑冓冕冖冤冦冢冩冪冫决冱冲冰况冽凅凉凛几處凩凭�凰凵凾刄刋刔刎刧刪刮刳刹剏剄剋剌剞剔剪剴剩剳剿剽劍劔劒剱劈劑辨辧劬劭劼劵勁勍勗勞勣勦飭勠勳勵勸勹匆匈甸匍匐匏匕匚匣匯匱匳匸區卆卅丗卉卍凖卞卩卮夘卻卷厂厖厠厦厥厮厰厶參簒雙叟曼燮叮叨叭叺吁吽呀听吭吼吮吶吩吝呎咏呵咎呟呱呷呰咒呻咀呶咄咐咆哇咢咸咥咬哄哈咨���".split("");
	for (j = 0; j != D[153].length; ++j) if (D[153][j].charCodeAt(0) !== 65533) {
		e[D[153][j]] = 39168 + j;
		d[39168 + j] = D[153][j];
	}
	D[154] = "����������������������������������������������������������������咫哂咤咾咼哘哥哦唏唔哽哮哭哺哢唹啀啣啌售啜啅啖啗唸唳啝喙喀咯喊喟啻啾喘喞單啼喃喩喇喨嗚嗅嗟嗄嗜嗤嗔嘔嗷嘖嗾嗽嘛嗹噎噐營嘴嘶嘲嘸�噫噤嘯噬噪嚆嚀嚊嚠嚔嚏嚥嚮嚶嚴囂嚼囁囃囀囈囎囑囓囗囮囹圀囿圄圉圈國圍圓團圖嗇圜圦圷圸坎圻址坏坩埀垈坡坿垉垓垠垳垤垪垰埃埆埔埒埓堊埖埣堋堙堝塲堡塢塋塰毀塒堽塹墅墹墟墫墺壞墻墸墮壅壓壑壗壙壘壥壜壤壟壯壺壹壻壼壽夂夊夐夛梦夥夬夭夲夸夾竒奕奐奎奚奘奢奠奧奬奩���".split("");
	for (j = 0; j != D[154].length; ++j) if (D[154][j].charCodeAt(0) !== 65533) {
		e[D[154][j]] = 39424 + j;
		d[39424 + j] = D[154][j];
	}
	D[155] = "����������������������������������������������������������������奸妁妝佞侫妣妲姆姨姜妍姙姚娥娟娑娜娉娚婀婬婉娵娶婢婪媚媼媾嫋嫂媽嫣嫗嫦嫩嫖嫺嫻嬌嬋嬖嬲嫐嬪嬶嬾孃孅孀孑孕孚孛孥孩孰孳孵學斈孺宀�它宦宸寃寇寉寔寐寤實寢寞寥寫寰寶寳尅將專對尓尠尢尨尸尹屁屆屎屓屐屏孱屬屮乢屶屹岌岑岔妛岫岻岶岼岷峅岾峇峙峩峽峺峭嶌峪崋崕崗嵜崟崛崑崔崢崚崙崘嵌嵒嵎嵋嵬嵳嵶嶇嶄嶂嶢嶝嶬嶮嶽嶐嶷嶼巉巍巓巒巖巛巫已巵帋帚帙帑帛帶帷幄幃幀幎幗幔幟幢幤幇幵并幺麼广庠廁廂廈廐廏���".split("");
	for (j = 0; j != D[155].length; ++j) if (D[155][j].charCodeAt(0) !== 65533) {
		e[D[155][j]] = 39680 + j;
		d[39680 + j] = D[155][j];
	}
	D[156] = "����������������������������������������������������������������廖廣廝廚廛廢廡廨廩廬廱廳廰廴廸廾弃弉彝彜弋弑弖弩弭弸彁彈彌彎弯彑彖彗彙彡彭彳彷徃徂彿徊很徑徇從徙徘徠徨徭徼忖忻忤忸忱忝悳忿怡恠�怙怐怩怎怱怛怕怫怦怏怺恚恁恪恷恟恊恆恍恣恃恤恂恬恫恙悁悍惧悃悚悄悛悖悗悒悧悋惡悸惠惓悴忰悽惆悵惘慍愕愆惶惷愀惴惺愃愡惻惱愍愎慇愾愨愧慊愿愼愬愴愽慂慄慳慷慘慙慚慫慴慯慥慱慟慝慓慵憙憖憇憬憔憚憊憑憫憮懌懊應懷懈懃懆憺懋罹懍懦懣懶懺懴懿懽懼懾戀戈戉戍戌戔戛���".split("");
	for (j = 0; j != D[156].length; ++j) if (D[156][j].charCodeAt(0) !== 65533) {
		e[D[156][j]] = 39936 + j;
		d[39936 + j] = D[156][j];
	}
	D[157] = "����������������������������������������������������������������戞戡截戮戰戲戳扁扎扞扣扛扠扨扼抂抉找抒抓抖拔抃抔拗拑抻拏拿拆擔拈拜拌拊拂拇抛拉挌拮拱挧挂挈拯拵捐挾捍搜捏掖掎掀掫捶掣掏掉掟掵捫�捩掾揩揀揆揣揉插揶揄搖搴搆搓搦搶攝搗搨搏摧摯摶摎攪撕撓撥撩撈撼據擒擅擇撻擘擂擱擧舉擠擡抬擣擯攬擶擴擲擺攀擽攘攜攅攤攣攫攴攵攷收攸畋效敖敕敍敘敞敝敲數斂斃變斛斟斫斷旃旆旁旄旌旒旛旙无旡旱杲昊昃旻杳昵昶昴昜晏晄晉晁晞晝晤晧晨晟晢晰暃暈暎暉暄暘暝曁暹曉暾暼���".split("");
	for (j = 0; j != D[157].length; ++j) if (D[157][j].charCodeAt(0) !== 65533) {
		e[D[157][j]] = 40192 + j;
		d[40192 + j] = D[157][j];
	}
	D[158] = "����������������������������������������������������������������曄暸曖曚曠昿曦曩曰曵曷朏朖朞朦朧霸朮朿朶杁朸朷杆杞杠杙杣杤枉杰枩杼杪枌枋枦枡枅枷柯枴柬枳柩枸柤柞柝柢柮枹柎柆柧檜栞框栩桀桍栲桎�梳栫桙档桷桿梟梏梭梔條梛梃檮梹桴梵梠梺椏梍桾椁棊椈棘椢椦棡椌棍棔棧棕椶椒椄棗棣椥棹棠棯椨椪椚椣椡棆楹楷楜楸楫楔楾楮椹楴椽楙椰楡楞楝榁楪榲榮槐榿槁槓榾槎寨槊槝榻槃榧樮榑榠榜榕榴槞槨樂樛槿權槹槲槧樅榱樞槭樔槫樊樒櫁樣樓橄樌橲樶橸橇橢橙橦橈樸樢檐檍檠檄檢檣���".split("");
	for (j = 0; j != D[158].length; ++j) if (D[158][j].charCodeAt(0) !== 65533) {
		e[D[158][j]] = 40448 + j;
		d[40448 + j] = D[158][j];
	}
	D[159] = "����������������������������������������������������������������檗蘗檻櫃櫂檸檳檬櫞櫑櫟檪櫚櫪櫻欅蘖櫺欒欖鬱欟欸欷盜欹飮歇歃歉歐歙歔歛歟歡歸歹歿殀殄殃殍殘殕殞殤殪殫殯殲殱殳殷殼毆毋毓毟毬毫毳毯�麾氈氓气氛氤氣汞汕汢汪沂沍沚沁沛汾汨汳沒沐泄泱泓沽泗泅泝沮沱沾沺泛泯泙泪洟衍洶洫洽洸洙洵洳洒洌浣涓浤浚浹浙涎涕濤涅淹渕渊涵淇淦涸淆淬淞淌淨淒淅淺淙淤淕淪淮渭湮渮渙湲湟渾渣湫渫湶湍渟湃渺湎渤滿渝游溂溪溘滉溷滓溽溯滄溲滔滕溏溥滂溟潁漑灌滬滸滾漿滲漱滯漲滌���".split("");
	for (j = 0; j != D[159].length; ++j) if (D[159][j].charCodeAt(0) !== 65533) {
		e[D[159][j]] = 40704 + j;
		d[40704 + j] = D[159][j];
	}
	D[224] = "����������������������������������������������������������������漾漓滷澆潺潸澁澀潯潛濳潭澂潼潘澎澑濂潦澳澣澡澤澹濆澪濟濕濬濔濘濱濮濛瀉瀋濺瀑瀁瀏濾瀛瀚潴瀝瀘瀟瀰瀾瀲灑灣炙炒炯烱炬炸炳炮烟烋烝�烙焉烽焜焙煥煕熈煦煢煌煖煬熏燻熄熕熨熬燗熹熾燒燉燔燎燠燬燧燵燼燹燿爍爐爛爨爭爬爰爲爻爼爿牀牆牋牘牴牾犂犁犇犒犖犢犧犹犲狃狆狄狎狒狢狠狡狹狷倏猗猊猜猖猝猴猯猩猥猾獎獏默獗獪獨獰獸獵獻獺珈玳珎玻珀珥珮珞璢琅瑯琥珸琲琺瑕琿瑟瑙瑁瑜瑩瑰瑣瑪瑶瑾璋璞璧瓊瓏瓔珱���".split("");
	for (j = 0; j != D[224].length; ++j) if (D[224][j].charCodeAt(0) !== 65533) {
		e[D[224][j]] = 57344 + j;
		d[57344 + j] = D[224][j];
	}
	D[225] = "����������������������������������������������������������������瓠瓣瓧瓩瓮瓲瓰瓱瓸瓷甄甃甅甌甎甍甕甓甞甦甬甼畄畍畊畉畛畆畚畩畤畧畫畭畸當疆疇畴疊疉疂疔疚疝疥疣痂疳痃疵疽疸疼疱痍痊痒痙痣痞痾痿�痼瘁痰痺痲痳瘋瘍瘉瘟瘧瘠瘡瘢瘤瘴瘰瘻癇癈癆癜癘癡癢癨癩癪癧癬癰癲癶癸發皀皃皈皋皎皖皓皙皚皰皴皸皹皺盂盍盖盒盞盡盥盧盪蘯盻眈眇眄眩眤眞眥眦眛眷眸睇睚睨睫睛睥睿睾睹瞎瞋瞑瞠瞞瞰瞶瞹瞿瞼瞽瞻矇矍矗矚矜矣矮矼砌砒礦砠礪硅碎硴碆硼碚碌碣碵碪碯磑磆磋磔碾碼磅磊磬���".split("");
	for (j = 0; j != D[225].length; ++j) if (D[225][j].charCodeAt(0) !== 65533) {
		e[D[225][j]] = 57600 + j;
		d[57600 + j] = D[225][j];
	}
	D[226] = "����������������������������������������������������������������磧磚磽磴礇礒礑礙礬礫祀祠祗祟祚祕祓祺祿禊禝禧齋禪禮禳禹禺秉秕秧秬秡秣稈稍稘稙稠稟禀稱稻稾稷穃穗穉穡穢穩龝穰穹穽窈窗窕窘窖窩竈窰�窶竅竄窿邃竇竊竍竏竕竓站竚竝竡竢竦竭竰笂笏笊笆笳笘笙笞笵笨笶筐筺笄筍笋筌筅筵筥筴筧筰筱筬筮箝箘箟箍箜箚箋箒箏筝箙篋篁篌篏箴篆篝篩簑簔篦篥籠簀簇簓篳篷簗簍篶簣簧簪簟簷簫簽籌籃籔籏籀籐籘籟籤籖籥籬籵粃粐粤粭粢粫粡粨粳粲粱粮粹粽糀糅糂糘糒糜糢鬻糯糲糴糶糺紆���".split("");
	for (j = 0; j != D[226].length; ++j) if (D[226][j].charCodeAt(0) !== 65533) {
		e[D[226][j]] = 57856 + j;
		d[57856 + j] = D[226][j];
	}
	D[227] = "����������������������������������������������������������������紂紜紕紊絅絋紮紲紿紵絆絳絖絎絲絨絮絏絣經綉絛綏絽綛綺綮綣綵緇綽綫總綢綯緜綸綟綰緘緝緤緞緻緲緡縅縊縣縡縒縱縟縉縋縢繆繦縻縵縹繃縷�縲縺繧繝繖繞繙繚繹繪繩繼繻纃緕繽辮繿纈纉續纒纐纓纔纖纎纛纜缸缺罅罌罍罎罐网罕罔罘罟罠罨罩罧罸羂羆羃羈羇羌羔羞羝羚羣羯羲羹羮羶羸譱翅翆翊翕翔翡翦翩翳翹飜耆耄耋耒耘耙耜耡耨耿耻聊聆聒聘聚聟聢聨聳聲聰聶聹聽聿肄肆肅肛肓肚肭冐肬胛胥胙胝胄胚胖脉胯胱脛脩脣脯腋���".split("");
	for (j = 0; j != D[227].length; ++j) if (D[227][j].charCodeAt(0) !== 65533) {
		e[D[227][j]] = 58112 + j;
		d[58112 + j] = D[227][j];
	}
	D[228] = "����������������������������������������������������������������隋腆脾腓腑胼腱腮腥腦腴膃膈膊膀膂膠膕膤膣腟膓膩膰膵膾膸膽臀臂膺臉臍臑臙臘臈臚臟臠臧臺臻臾舁舂舅與舊舍舐舖舩舫舸舳艀艙艘艝艚艟艤�艢艨艪艫舮艱艷艸艾芍芒芫芟芻芬苡苣苟苒苴苳苺莓范苻苹苞茆苜茉苙茵茴茖茲茱荀茹荐荅茯茫茗茘莅莚莪莟莢莖茣莎莇莊荼莵荳荵莠莉莨菴萓菫菎菽萃菘萋菁菷萇菠菲萍萢萠莽萸蔆菻葭萪萼蕚蒄葷葫蒭葮蒂葩葆萬葯葹萵蓊葢蒹蒿蒟蓙蓍蒻蓚蓐蓁蓆蓖蒡蔡蓿蓴蔗蔘蔬蔟蔕蔔蓼蕀蕣蕘蕈���".split("");
	for (j = 0; j != D[228].length; ++j) if (D[228][j].charCodeAt(0) !== 65533) {
		e[D[228][j]] = 58368 + j;
		d[58368 + j] = D[228][j];
	}
	D[229] = "����������������������������������������������������������������蕁蘂蕋蕕薀薤薈薑薊薨蕭薔薛藪薇薜蕷蕾薐藉薺藏薹藐藕藝藥藜藹蘊蘓蘋藾藺蘆蘢蘚蘰蘿虍乕虔號虧虱蚓蚣蚩蚪蚋蚌蚶蚯蛄蛆蚰蛉蠣蚫蛔蛞蛩蛬�蛟蛛蛯蜒蜆蜈蜀蜃蛻蜑蜉蜍蛹蜊蜴蜿蜷蜻蜥蜩蜚蝠蝟蝸蝌蝎蝴蝗蝨蝮蝙蝓蝣蝪蠅螢螟螂螯蟋螽蟀蟐雖螫蟄螳蟇蟆螻蟯蟲蟠蠏蠍蟾蟶蟷蠎蟒蠑蠖蠕蠢蠡蠱蠶蠹蠧蠻衄衂衒衙衞衢衫袁衾袞衵衽袵衲袂袗袒袮袙袢袍袤袰袿袱裃裄裔裘裙裝裹褂裼裴裨裲褄褌褊褓襃褞褥褪褫襁襄褻褶褸襌褝襠襞���".split("");
	for (j = 0; j != D[229].length; ++j) if (D[229][j].charCodeAt(0) !== 65533) {
		e[D[229][j]] = 58624 + j;
		d[58624 + j] = D[229][j];
	}
	D[230] = "����������������������������������������������������������������襦襤襭襪襯襴襷襾覃覈覊覓覘覡覩覦覬覯覲覺覽覿觀觚觜觝觧觴觸訃訖訐訌訛訝訥訶詁詛詒詆詈詼詭詬詢誅誂誄誨誡誑誥誦誚誣諄諍諂諚諫諳諧�諤諱謔諠諢諷諞諛謌謇謚諡謖謐謗謠謳鞫謦謫謾謨譁譌譏譎證譖譛譚譫譟譬譯譴譽讀讌讎讒讓讖讙讚谺豁谿豈豌豎豐豕豢豬豸豺貂貉貅貊貍貎貔豼貘戝貭貪貽貲貳貮貶賈賁賤賣賚賽賺賻贄贅贊贇贏贍贐齎贓賍贔贖赧赭赱赳趁趙跂趾趺跏跚跖跌跛跋跪跫跟跣跼踈踉跿踝踞踐踟蹂踵踰踴蹊���".split("");
	for (j = 0; j != D[230].length; ++j) if (D[230][j].charCodeAt(0) !== 65533) {
		e[D[230][j]] = 58880 + j;
		d[58880 + j] = D[230][j];
	}
	D[231] = "����������������������������������������������������������������蹇蹉蹌蹐蹈蹙蹤蹠踪蹣蹕蹶蹲蹼躁躇躅躄躋躊躓躑躔躙躪躡躬躰軆躱躾軅軈軋軛軣軼軻軫軾輊輅輕輒輙輓輜輟輛輌輦輳輻輹轅轂輾轌轉轆轎轗轜�轢轣轤辜辟辣辭辯辷迚迥迢迪迯邇迴逅迹迺逑逕逡逍逞逖逋逧逶逵逹迸遏遐遑遒逎遉逾遖遘遞遨遯遶隨遲邂遽邁邀邊邉邏邨邯邱邵郢郤扈郛鄂鄒鄙鄲鄰酊酖酘酣酥酩酳酲醋醉醂醢醫醯醪醵醴醺釀釁釉釋釐釖釟釡釛釼釵釶鈞釿鈔鈬鈕鈑鉞鉗鉅鉉鉤鉈銕鈿鉋鉐銜銖銓銛鉚鋏銹銷鋩錏鋺鍄錮���".split("");
	for (j = 0; j != D[231].length; ++j) if (D[231][j].charCodeAt(0) !== 65533) {
		e[D[231][j]] = 59136 + j;
		d[59136 + j] = D[231][j];
	}
	D[232] = "����������������������������������������������������������������錙錢錚錣錺錵錻鍜鍠鍼鍮鍖鎰鎬鎭鎔鎹鏖鏗鏨鏥鏘鏃鏝鏐鏈鏤鐚鐔鐓鐃鐇鐐鐶鐫鐵鐡鐺鑁鑒鑄鑛鑠鑢鑞鑪鈩鑰鑵鑷鑽鑚鑼鑾钁鑿閂閇閊閔閖閘閙�閠閨閧閭閼閻閹閾闊濶闃闍闌闕闔闖關闡闥闢阡阨阮阯陂陌陏陋陷陜陞陝陟陦陲陬隍隘隕隗險隧隱隲隰隴隶隸隹雎雋雉雍襍雜霍雕雹霄霆霈霓霎霑霏霖霙霤霪霰霹霽霾靄靆靈靂靉靜靠靤靦靨勒靫靱靹鞅靼鞁靺鞆鞋鞏鞐鞜鞨鞦鞣鞳鞴韃韆韈韋韜韭齏韲竟韶韵頏頌頸頤頡頷頽顆顏顋顫顯顰���".split("");
	for (j = 0; j != D[232].length; ++j) if (D[232][j].charCodeAt(0) !== 65533) {
		e[D[232][j]] = 59392 + j;
		d[59392 + j] = D[232][j];
	}
	D[233] = "����������������������������������������������������������������顱顴顳颪颯颱颶飄飃飆飩飫餃餉餒餔餘餡餝餞餤餠餬餮餽餾饂饉饅饐饋饑饒饌饕馗馘馥馭馮馼駟駛駝駘駑駭駮駱駲駻駸騁騏騅駢騙騫騷驅驂驀驃�騾驕驍驛驗驟驢驥驤驩驫驪骭骰骼髀髏髑髓體髞髟髢髣髦髯髫髮髴髱髷髻鬆鬘鬚鬟鬢鬣鬥鬧鬨鬩鬪鬮鬯鬲魄魃魏魍魎魑魘魴鮓鮃鮑鮖鮗鮟鮠鮨鮴鯀鯊鮹鯆鯏鯑鯒鯣鯢鯤鯔鯡鰺鯲鯱鯰鰕鰔鰉鰓鰌鰆鰈鰒鰊鰄鰮鰛鰥鰤鰡鰰鱇鰲鱆鰾鱚鱠鱧鱶鱸鳧鳬鳰鴉鴈鳫鴃鴆鴪鴦鶯鴣鴟鵄鴕鴒鵁鴿鴾鵆鵈���".split("");
	for (j = 0; j != D[233].length; ++j) if (D[233][j].charCodeAt(0) !== 65533) {
		e[D[233][j]] = 59648 + j;
		d[59648 + j] = D[233][j];
	}
	D[234] = "����������������������������������������������������������������鵝鵞鵤鵑鵐鵙鵲鶉鶇鶫鵯鵺鶚鶤鶩鶲鷄鷁鶻鶸鶺鷆鷏鷂鷙鷓鷸鷦鷭鷯鷽鸚鸛鸞鹵鹹鹽麁麈麋麌麒麕麑麝麥麩麸麪麭靡黌黎黏黐黔黜點黝黠黥黨黯�黴黶黷黹黻黼黽鼇鼈皷鼕鼡鼬鼾齊齒齔齣齟齠齡齦齧齬齪齷齲齶龕龜龠堯槇遙瑤凜熙�������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[234].length; ++j) if (D[234][j].charCodeAt(0) !== 65533) {
		e[D[234][j]] = 59904 + j;
		d[59904 + j] = D[234][j];
	}
	D[237] = "����������������������������������������������������������������纊褜鍈銈蓜俉炻昱棈鋹曻彅丨仡仼伀伃伹佖侒侊侚侔俍偀倢俿倞偆偰偂傔僴僘兊兤冝冾凬刕劜劦勀勛匀匇匤卲厓厲叝﨎咜咊咩哿喆坙坥垬埈埇﨏�塚增墲夋奓奛奝奣妤妺孖寀甯寘寬尞岦岺峵崧嵓﨑嵂嵭嶸嶹巐弡弴彧德忞恝悅悊惞惕愠惲愑愷愰憘戓抦揵摠撝擎敎昀昕昻昉昮昞昤晥晗晙晴晳暙暠暲暿曺朎朗杦枻桒柀栁桄棏﨓楨﨔榘槢樰橫橆橳橾櫢櫤毖氿汜沆汯泚洄涇浯涖涬淏淸淲淼渹湜渧渼溿澈澵濵瀅瀇瀨炅炫焏焄煜煆煇凞燁燾犱���".split("");
	for (j = 0; j != D[237].length; ++j) if (D[237][j].charCodeAt(0) !== 65533) {
		e[D[237][j]] = 60672 + j;
		d[60672 + j] = D[237][j];
	}
	D[238] = "����������������������������������������������������������������犾猤猪獷玽珉珖珣珒琇珵琦琪琩琮瑢璉璟甁畯皂皜皞皛皦益睆劯砡硎硤硺礰礼神祥禔福禛竑竧靖竫箞精絈絜綷綠緖繒罇羡羽茁荢荿菇菶葈蒴蕓蕙�蕫﨟薰蘒﨡蠇裵訒訷詹誧誾諟諸諶譓譿賰賴贒赶﨣軏﨤逸遧郞都鄕鄧釚釗釞釭釮釤釥鈆鈐鈊鈺鉀鈼鉎鉙鉑鈹鉧銧鉷鉸鋧鋗鋙鋐﨧鋕鋠鋓錥錡鋻﨨錞鋿錝錂鍰鍗鎤鏆鏞鏸鐱鑅鑈閒隆﨩隝隯霳霻靃靍靏靑靕顗顥飯飼餧館馞驎髙髜魵魲鮏鮱鮻鰀鵰鵫鶴鸙黑��ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ￢￤＇＂���".split("");
	for (j = 0; j != D[238].length; ++j) if (D[238][j].charCodeAt(0) !== 65533) {
		e[D[238][j]] = 60928 + j;
		d[60928 + j] = D[238][j];
	}
	D[250] = "����������������������������������������������������������������ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ￢￤＇＂㈱№℡∵纊褜鍈銈蓜俉炻昱棈鋹曻彅丨仡仼伀伃伹佖侒侊侚侔俍偀倢俿倞偆偰偂傔僴僘兊�兤冝冾凬刕劜劦勀勛匀匇匤卲厓厲叝﨎咜咊咩哿喆坙坥垬埈埇﨏塚增墲夋奓奛奝奣妤妺孖寀甯寘寬尞岦岺峵崧嵓﨑嵂嵭嶸嶹巐弡弴彧德忞恝悅悊惞惕愠惲愑愷愰憘戓抦揵摠撝擎敎昀昕昻昉昮昞昤晥晗晙晴晳暙暠暲暿曺朎朗杦枻桒柀栁桄棏﨓楨﨔榘槢樰橫橆橳橾櫢櫤毖氿汜沆汯泚洄涇浯���".split("");
	for (j = 0; j != D[250].length; ++j) if (D[250][j].charCodeAt(0) !== 65533) {
		e[D[250][j]] = 64e3 + j;
		d[64e3 + j] = D[250][j];
	}
	D[251] = "����������������������������������������������������������������涖涬淏淸淲淼渹湜渧渼溿澈澵濵瀅瀇瀨炅炫焏焄煜煆煇凞燁燾犱犾猤猪獷玽珉珖珣珒琇珵琦琪琩琮瑢璉璟甁畯皂皜皞皛皦益睆劯砡硎硤硺礰礼神�祥禔福禛竑竧靖竫箞精絈絜綷綠緖繒罇羡羽茁荢荿菇菶葈蒴蕓蕙蕫﨟薰蘒﨡蠇裵訒訷詹誧誾諟諸諶譓譿賰賴贒赶﨣軏﨤逸遧郞都鄕鄧釚釗釞釭釮釤釥鈆鈐鈊鈺鉀鈼鉎鉙鉑鈹鉧銧鉷鉸鋧鋗鋙鋐﨧鋕鋠鋓錥錡鋻﨨錞鋿錝錂鍰鍗鎤鏆鏞鏸鐱鑅鑈閒隆﨩隝隯霳霻靃靍靏靑靕顗顥飯飼餧館馞驎髙���".split("");
	for (j = 0; j != D[251].length; ++j) if (D[251][j].charCodeAt(0) !== 65533) {
		e[D[251][j]] = 64256 + j;
		d[64256 + j] = D[251][j];
	}
	D[252] = "����������������������������������������������������������������髜魵魲鮏鮱鮻鰀鵰鵫鶴鸙黑������������������������������������������������������������������������������������������������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[252].length; ++j) if (D[252][j].charCodeAt(0) !== 65533) {
		e[D[252][j]] = 64512 + j;
		d[64512 + j] = D[252][j];
	}
	return {
		"enc": e,
		"dec": d
	};
})();
cptable[936] = (function() {
	var d = [], e = {}, D = [], j;
	D[0] = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€�������������������������������������������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[0].length; ++j) if (D[0][j].charCodeAt(0) !== 65533) {
		e[D[0][j]] = 0 + j;
		d[0 + j] = D[0][j];
	}
	D[129] = "����������������������������������������������������������������丂丄丅丆丏丒丗丟丠両丣並丩丮丯丱丳丵丷丼乀乁乂乄乆乊乑乕乗乚乛乢乣乤乥乧乨乪乫乬乭乮乯乲乴乵乶乷乸乹乺乻乼乽乿亀亁亂亃亄亅亇亊�亐亖亗亙亜亝亞亣亪亯亰亱亴亶亷亸亹亼亽亾仈仌仏仐仒仚仛仜仠仢仦仧仩仭仮仯仱仴仸仹仺仼仾伀伂伃伄伅伆伇伈伋伌伒伓伔伕伖伜伝伡伣伨伩伬伭伮伱伳伵伷伹伻伾伿佀佁佂佄佅佇佈佉佊佋佌佒佔佖佡佢佦佨佪佫佭佮佱佲併佷佸佹佺佽侀侁侂侅來侇侊侌侎侐侒侓侕侖侘侙侚侜侞侟価侢�".split("");
	for (j = 0; j != D[129].length; ++j) if (D[129][j].charCodeAt(0) !== 65533) {
		e[D[129][j]] = 33024 + j;
		d[33024 + j] = D[129][j];
	}
	D[130] = "����������������������������������������������������������������侤侫侭侰侱侲侳侴侶侷侸侹侺侻侼侽侾俀俁係俆俇俈俉俋俌俍俒俓俔俕俖俙俛俠俢俤俥俧俫俬俰俲俴俵俶俷俹俻俼俽俿倀倁倂倃倄倅倆倇倈倉倊�個倎倐們倓倕倖倗倛倝倞倠倢倣値倧倫倯倰倱倲倳倴倵倶倷倸倹倻倽倿偀偁偂偄偅偆偉偊偋偍偐偑偒偓偔偖偗偘偙偛偝偞偟偠偡偢偣偤偦偧偨偩偪偫偭偮偯偰偱偲偳側偵偸偹偺偼偽傁傂傃傄傆傇傉傊傋傌傎傏傐傑傒傓傔傕傖傗傘備傚傛傜傝傞傟傠傡傢傤傦傪傫傭傮傯傰傱傳傴債傶傷傸傹傼�".split("");
	for (j = 0; j != D[130].length; ++j) if (D[130][j].charCodeAt(0) !== 65533) {
		e[D[130][j]] = 33280 + j;
		d[33280 + j] = D[130][j];
	}
	D[131] = "����������������������������������������������������������������傽傾傿僀僁僂僃僄僅僆僇僈僉僊僋僌働僎僐僑僒僓僔僕僗僘僙僛僜僝僞僟僠僡僢僣僤僥僨僩僪僫僯僰僱僲僴僶僷僸價僺僼僽僾僿儀儁儂儃億儅儈�儉儊儌儍儎儏儐儑儓儔儕儖儗儘儙儚儛儜儝儞償儠儢儣儤儥儦儧儨儩優儫儬儭儮儯儰儱儲儳儴儵儶儷儸儹儺儻儼儽儾兂兇兊兌兎兏児兒兓兗兘兙兛兝兞兟兠兡兣兤兦內兩兪兯兲兺兾兿冃冄円冇冊冋冎冏冐冑冓冔冘冚冝冞冟冡冣冦冧冨冩冪冭冮冴冸冹冺冾冿凁凂凃凅凈凊凍凎凐凒凓凔凕凖凗�".split("");
	for (j = 0; j != D[131].length; ++j) if (D[131][j].charCodeAt(0) !== 65533) {
		e[D[131][j]] = 33536 + j;
		d[33536 + j] = D[131][j];
	}
	D[132] = "����������������������������������������������������������������凘凙凚凜凞凟凢凣凥処凧凨凩凪凬凮凱凲凴凷凾刄刅刉刋刌刏刐刓刔刕刜刞刟刡刢刣別刦刧刪刬刯刱刲刴刵刼刾剄剅剆則剈剉剋剎剏剒剓剕剗剘�剙剚剛剝剟剠剢剣剤剦剨剫剬剭剮剰剱剳剴創剶剷剸剹剺剻剼剾劀劃劄劅劆劇劉劊劋劌劍劎劏劑劒劔劕劖劗劘劙劚劜劤劥劦劧劮劯劰労劵劶劷劸効劺劻劼劽勀勁勂勄勅勆勈勊勌勍勎勏勑勓勔動勗務勚勛勜勝勞勠勡勢勣勥勦勧勨勩勪勫勬勭勮勯勱勲勳勴勵勶勷勸勻勼勽匁匂匃匄匇匉匊匋匌匎�".split("");
	for (j = 0; j != D[132].length; ++j) if (D[132][j].charCodeAt(0) !== 65533) {
		e[D[132][j]] = 33792 + j;
		d[33792 + j] = D[132][j];
	}
	D[133] = "����������������������������������������������������������������匑匒匓匔匘匛匜匞匟匢匤匥匧匨匩匫匬匭匯匰匱匲匳匴匵匶匷匸匼匽區卂卄卆卋卌卍卐協単卙卛卝卥卨卪卬卭卲卶卹卻卼卽卾厀厁厃厇厈厊厎厏�厐厑厒厓厔厖厗厙厛厜厞厠厡厤厧厪厫厬厭厯厰厱厲厳厴厵厷厸厹厺厼厽厾叀參叄叅叆叇収叏叐叒叓叕叚叜叝叞叡叢叧叴叺叾叿吀吂吅吇吋吔吘吙吚吜吢吤吥吪吰吳吶吷吺吽吿呁呂呄呅呇呉呌呍呎呏呑呚呝呞呟呠呡呣呥呧呩呪呫呬呭呮呯呰呴呹呺呾呿咁咃咅咇咈咉咊咍咑咓咗咘咜咞咟咠咡�".split("");
	for (j = 0; j != D[133].length; ++j) if (D[133][j].charCodeAt(0) !== 65533) {
		e[D[133][j]] = 34048 + j;
		d[34048 + j] = D[133][j];
	}
	D[134] = "����������������������������������������������������������������咢咥咮咰咲咵咶咷咹咺咼咾哃哅哊哋哖哘哛哠員哢哣哤哫哬哯哰哱哴哵哶哷哸哹哻哾唀唂唃唄唅唈唊唋唌唍唎唒唓唕唖唗唘唙唚唜唝唞唟唡唥唦�唨唩唫唭唲唴唵唶唸唹唺唻唽啀啂啅啇啈啋啌啍啎問啑啒啓啔啗啘啙啚啛啝啞啟啠啢啣啨啩啫啯啰啱啲啳啴啹啺啽啿喅喆喌喍喎喐喒喓喕喖喗喚喛喞喠喡喢喣喤喥喦喨喩喪喫喬喭單喯喰喲喴営喸喺喼喿嗀嗁嗂嗃嗆嗇嗈嗊嗋嗎嗏嗐嗕嗗嗘嗙嗚嗛嗞嗠嗢嗧嗩嗭嗮嗰嗱嗴嗶嗸嗹嗺嗻嗼嗿嘂嘃嘄嘅�".split("");
	for (j = 0; j != D[134].length; ++j) if (D[134][j].charCodeAt(0) !== 65533) {
		e[D[134][j]] = 34304 + j;
		d[34304 + j] = D[134][j];
	}
	D[135] = "����������������������������������������������������������������嘆嘇嘊嘋嘍嘐嘑嘒嘓嘔嘕嘖嘗嘙嘚嘜嘝嘠嘡嘢嘥嘦嘨嘩嘪嘫嘮嘯嘰嘳嘵嘷嘸嘺嘼嘽嘾噀噁噂噃噄噅噆噇噈噉噊噋噏噐噑噒噓噕噖噚噛噝噞噟噠噡�噣噥噦噧噭噮噯噰噲噳噴噵噷噸噹噺噽噾噿嚀嚁嚂嚃嚄嚇嚈嚉嚊嚋嚌嚍嚐嚑嚒嚔嚕嚖嚗嚘嚙嚚嚛嚜嚝嚞嚟嚠嚡嚢嚤嚥嚦嚧嚨嚩嚪嚫嚬嚭嚮嚰嚱嚲嚳嚴嚵嚶嚸嚹嚺嚻嚽嚾嚿囀囁囂囃囄囅囆囇囈囉囋囌囍囎囏囐囑囒囓囕囖囘囙囜団囥囦囧囨囩囪囬囮囯囲図囶囷囸囻囼圀圁圂圅圇國圌圍圎圏圐圑�".split("");
	for (j = 0; j != D[135].length; ++j) if (D[135][j].charCodeAt(0) !== 65533) {
		e[D[135][j]] = 34560 + j;
		d[34560 + j] = D[135][j];
	}
	D[136] = "����������������������������������������������������������������園圓圔圕圖圗團圙圚圛圝圞圠圡圢圤圥圦圧圫圱圲圴圵圶圷圸圼圽圿坁坃坄坅坆坈坉坋坒坓坔坕坖坘坙坢坣坥坧坬坮坰坱坲坴坵坸坹坺坽坾坿垀�垁垇垈垉垊垍垎垏垐垑垔垕垖垗垘垙垚垜垝垞垟垥垨垪垬垯垰垱垳垵垶垷垹垺垻垼垽垾垿埀埁埄埅埆埇埈埉埊埌埍埐埑埓埖埗埛埜埞埡埢埣埥埦埧埨埩埪埫埬埮埰埱埲埳埵埶執埻埼埾埿堁堃堄堅堈堉堊堌堎堏堐堒堓堔堖堗堘堚堛堜堝堟堢堣堥堦堧堨堩堫堬堭堮堯報堲堳場堶堷堸堹堺堻堼堽�".split("");
	for (j = 0; j != D[136].length; ++j) if (D[136][j].charCodeAt(0) !== 65533) {
		e[D[136][j]] = 34816 + j;
		d[34816 + j] = D[136][j];
	}
	D[137] = "����������������������������������������������������������������堾堿塀塁塂塃塅塆塇塈塉塊塋塎塏塐塒塓塕塖塗塙塚塛塜塝塟塠塡塢塣塤塦塧塨塩塪塭塮塯塰塱塲塳塴塵塶塷塸塹塺塻塼塽塿墂墄墆墇墈墊墋墌�墍墎墏墐墑墔墕墖増墘墛墜墝墠墡墢墣墤墥墦墧墪墫墬墭墮墯墰墱墲墳墴墵墶墷墸墹墺墻墽墾墿壀壂壃壄壆壇壈壉壊壋壌壍壎壏壐壒壓壔壖壗壘壙壚壛壜壝壞壟壠壡壢壣壥壦壧壨壩壪壭壯壱売壴壵壷壸壺壻壼壽壾壿夀夁夃夅夆夈変夊夋夌夎夐夑夒夓夗夘夛夝夞夠夡夢夣夦夨夬夰夲夳夵夶夻�".split("");
	for (j = 0; j != D[137].length; ++j) if (D[137][j].charCodeAt(0) !== 65533) {
		e[D[137][j]] = 35072 + j;
		d[35072 + j] = D[137][j];
	}
	D[138] = "����������������������������������������������������������������夽夾夿奀奃奅奆奊奌奍奐奒奓奙奛奜奝奞奟奡奣奤奦奧奨奩奪奫奬奭奮奯奰奱奲奵奷奺奻奼奾奿妀妅妉妋妌妎妏妐妑妔妕妘妚妛妜妝妟妠妡妢妦�妧妬妭妰妱妳妴妵妶妷妸妺妼妽妿姀姁姂姃姄姅姇姈姉姌姍姎姏姕姖姙姛姞姟姠姡姢姤姦姧姩姪姫姭姮姯姰姱姲姳姴姵姶姷姸姺姼姽姾娀娂娊娋娍娎娏娐娒娔娕娖娗娙娚娛娝娞娡娢娤娦娧娨娪娫娬娭娮娯娰娳娵娷娸娹娺娻娽娾娿婁婂婃婄婅婇婈婋婌婍婎婏婐婑婒婓婔婖婗婘婙婛婜婝婞婟婠�".split("");
	for (j = 0; j != D[138].length; ++j) if (D[138][j].charCodeAt(0) !== 65533) {
		e[D[138][j]] = 35328 + j;
		d[35328 + j] = D[138][j];
	}
	D[139] = "����������������������������������������������������������������婡婣婤婥婦婨婩婫婬婭婮婯婰婱婲婳婸婹婻婼婽婾媀媁媂媃媄媅媆媇媈媉媊媋媌媍媎媏媐媑媓媔媕媖媗媘媙媜媝媞媟媠媡媢媣媤媥媦媧媨媩媫媬�媭媮媯媰媱媴媶媷媹媺媻媼媽媿嫀嫃嫄嫅嫆嫇嫈嫊嫋嫍嫎嫏嫐嫑嫓嫕嫗嫙嫚嫛嫝嫞嫟嫢嫤嫥嫧嫨嫪嫬嫭嫮嫯嫰嫲嫳嫴嫵嫶嫷嫸嫹嫺嫻嫼嫽嫾嫿嬀嬁嬂嬃嬄嬅嬆嬇嬈嬊嬋嬌嬍嬎嬏嬐嬑嬒嬓嬔嬕嬘嬙嬚嬛嬜嬝嬞嬟嬠嬡嬢嬣嬤嬥嬦嬧嬨嬩嬪嬫嬬嬭嬮嬯嬰嬱嬳嬵嬶嬸嬹嬺嬻嬼嬽嬾嬿孁孂孃孄孅孆孇�".split("");
	for (j = 0; j != D[139].length; ++j) if (D[139][j].charCodeAt(0) !== 65533) {
		e[D[139][j]] = 35584 + j;
		d[35584 + j] = D[139][j];
	}
	D[140] = "����������������������������������������������������������������孈孉孊孋孌孍孎孏孒孖孞孠孡孧孨孫孭孮孯孲孴孶孷學孹孻孼孾孿宂宆宊宍宎宐宑宒宔宖実宧宨宩宬宭宮宯宱宲宷宺宻宼寀寁寃寈寉寊寋寍寎寏�寑寔寕寖寗寘寙寚寛寜寠寢寣實寧審寪寫寬寭寯寱寲寳寴寵寶寷寽対尀専尃尅將專尋尌對導尐尒尓尗尙尛尞尟尠尡尣尦尨尩尪尫尭尮尯尰尲尳尵尶尷屃屄屆屇屌屍屒屓屔屖屗屘屚屛屜屝屟屢層屧屨屩屪屫屬屭屰屲屳屴屵屶屷屸屻屼屽屾岀岃岄岅岆岇岉岊岋岎岏岒岓岕岝岞岟岠岡岤岥岦岧岨�".split("");
	for (j = 0; j != D[140].length; ++j) if (D[140][j].charCodeAt(0) !== 65533) {
		e[D[140][j]] = 35840 + j;
		d[35840 + j] = D[140][j];
	}
	D[141] = "����������������������������������������������������������������岪岮岯岰岲岴岶岹岺岻岼岾峀峂峃峅峆峇峈峉峊峌峍峎峏峐峑峓峔峕峖峗峘峚峛峜峝峞峟峠峢峣峧峩峫峬峮峯峱峲峳峴峵島峷峸峹峺峼峽峾峿崀�崁崄崅崈崉崊崋崌崍崏崐崑崒崓崕崗崘崙崚崜崝崟崠崡崢崣崥崨崪崫崬崯崰崱崲崳崵崶崷崸崹崺崻崼崿嵀嵁嵂嵃嵄嵅嵆嵈嵉嵍嵎嵏嵐嵑嵒嵓嵔嵕嵖嵗嵙嵚嵜嵞嵟嵠嵡嵢嵣嵤嵥嵦嵧嵨嵪嵭嵮嵰嵱嵲嵳嵵嵶嵷嵸嵹嵺嵻嵼嵽嵾嵿嶀嶁嶃嶄嶅嶆嶇嶈嶉嶊嶋嶌嶍嶎嶏嶐嶑嶒嶓嶔嶕嶖嶗嶘嶚嶛嶜嶞嶟嶠�".split("");
	for (j = 0; j != D[141].length; ++j) if (D[141][j].charCodeAt(0) !== 65533) {
		e[D[141][j]] = 36096 + j;
		d[36096 + j] = D[141][j];
	}
	D[142] = "����������������������������������������������������������������嶡嶢嶣嶤嶥嶦嶧嶨嶩嶪嶫嶬嶭嶮嶯嶰嶱嶲嶳嶴嶵嶶嶸嶹嶺嶻嶼嶽嶾嶿巀巁巂巃巄巆巇巈巉巊巋巌巎巏巐巑巒巓巔巕巖巗巘巙巚巜巟巠巣巤巪巬巭�巰巵巶巸巹巺巻巼巿帀帄帇帉帊帋帍帎帒帓帗帞帟帠帡帢帣帤帥帨帩帪師帬帯帰帲帳帴帵帶帹帺帾帿幀幁幃幆幇幈幉幊幋幍幎幏幐幑幒幓幖幗幘幙幚幜幝幟幠幣幤幥幦幧幨幩幪幫幬幭幮幯幰幱幵幷幹幾庁庂広庅庈庉庌庍庎庒庘庛庝庡庢庣庤庨庩庪庫庬庮庯庰庱庲庴庺庻庼庽庿廀廁廂廃廄廅�".split("");
	for (j = 0; j != D[142].length; ++j) if (D[142][j].charCodeAt(0) !== 65533) {
		e[D[142][j]] = 36352 + j;
		d[36352 + j] = D[142][j];
	}
	D[143] = "����������������������������������������������������������������廆廇廈廋廌廍廎廏廐廔廕廗廘廙廚廜廝廞廟廠廡廢廣廤廥廦廧廩廫廬廭廮廯廰廱廲廳廵廸廹廻廼廽弅弆弇弉弌弍弎弐弒弔弖弙弚弜弝弞弡弢弣弤�弨弫弬弮弰弲弳弴張弶強弸弻弽弾弿彁彂彃彄彅彆彇彈彉彊彋彌彍彎彏彑彔彙彚彛彜彞彟彠彣彥彧彨彫彮彯彲彴彵彶彸彺彽彾彿徃徆徍徎徏徑従徔徖徚徛徝從徟徠徢徣徤徥徦徧復徫徬徯徰徱徲徳徴徶徸徹徺徻徾徿忀忁忂忇忈忊忋忎忓忔忕忚忛応忞忟忢忣忥忦忨忩忬忯忰忲忳忴忶忷忹忺忼怇�".split("");
	for (j = 0; j != D[143].length; ++j) if (D[143][j].charCodeAt(0) !== 65533) {
		e[D[143][j]] = 36608 + j;
		d[36608 + j] = D[143][j];
	}
	D[144] = "����������������������������������������������������������������怈怉怋怌怐怑怓怗怘怚怞怟怢怣怤怬怭怮怰怱怲怳怴怶怷怸怹怺怽怾恀恄恅恆恇恈恉恊恌恎恏恑恓恔恖恗恘恛恜恞恟恠恡恥恦恮恱恲恴恵恷恾悀�悁悂悅悆悇悈悊悋悎悏悐悑悓悕悗悘悙悜悞悡悢悤悥悧悩悪悮悰悳悵悶悷悹悺悽悾悿惀惁惂惃惄惇惈惉惌惍惎惏惐惒惓惔惖惗惙惛惞惡惢惣惤惥惪惱惲惵惷惸惻惼惽惾惿愂愃愄愅愇愊愋愌愐愑愒愓愔愖愗愘愙愛愜愝愞愡愢愥愨愩愪愬愭愮愯愰愱愲愳愴愵愶愷愸愹愺愻愼愽愾慀慁慂慃慄慅慆�".split("");
	for (j = 0; j != D[144].length; ++j) if (D[144][j].charCodeAt(0) !== 65533) {
		e[D[144][j]] = 36864 + j;
		d[36864 + j] = D[144][j];
	}
	D[145] = "����������������������������������������������������������������慇慉態慍慏慐慒慓慔慖慗慘慙慚慛慜慞慟慠慡慣慤慥慦慩慪慫慬慭慮慯慱慲慳慴慶慸慹慺慻慼慽慾慿憀憁憂憃憄憅憆憇憈憉憊憌憍憏憐憑憒憓憕�憖憗憘憙憚憛憜憞憟憠憡憢憣憤憥憦憪憫憭憮憯憰憱憲憳憴憵憶憸憹憺憻憼憽憿懀懁懃懄懅懆懇應懌懍懎懏懐懓懕懖懗懘懙懚懛懜懝懞懟懠懡懢懣懤懥懧懨懩懪懫懬懭懮懯懰懱懲懳懴懶懷懸懹懺懻懼懽懾戀戁戂戃戄戅戇戉戓戔戙戜戝戞戠戣戦戧戨戩戫戭戯戰戱戲戵戶戸戹戺戻戼扂扄扅扆扊�".split("");
	for (j = 0; j != D[145].length; ++j) if (D[145][j].charCodeAt(0) !== 65533) {
		e[D[145][j]] = 37120 + j;
		d[37120 + j] = D[145][j];
	}
	D[146] = "����������������������������������������������������������������扏扐払扖扗扙扚扜扝扞扟扠扡扢扤扥扨扱扲扴扵扷扸扺扻扽抁抂抃抅抆抇抈抋抌抍抎抏抐抔抙抜抝択抣抦抧抩抪抭抮抯抰抲抳抴抶抷抸抺抾拀拁�拃拋拏拑拕拝拞拠拡拤拪拫拰拲拵拸拹拺拻挀挃挄挅挆挊挋挌挍挏挐挒挓挔挕挗挘挙挜挦挧挩挬挭挮挰挱挳挴挵挶挷挸挻挼挾挿捀捁捄捇捈捊捑捒捓捔捖捗捘捙捚捛捜捝捠捤捥捦捨捪捫捬捯捰捲捳捴捵捸捹捼捽捾捿掁掃掄掅掆掋掍掑掓掔掕掗掙掚掛掜掝掞掟採掤掦掫掯掱掲掵掶掹掻掽掿揀�".split("");
	for (j = 0; j != D[146].length; ++j) if (D[146][j].charCodeAt(0) !== 65533) {
		e[D[146][j]] = 37376 + j;
		d[37376 + j] = D[146][j];
	}
	D[147] = "����������������������������������������������������������������揁揂揃揅揇揈揊揋揌揑揓揔揕揗揘揙揚換揜揝揟揢揤揥揦揧揨揫揬揮揯揰揱揳揵揷揹揺揻揼揾搃搄搆搇搈搉搊損搎搑搒搕搖搗搘搙搚搝搟搢搣搤�搥搧搨搩搫搮搯搰搱搲搳搵搶搷搸搹搻搼搾摀摂摃摉摋摌摍摎摏摐摑摓摕摖摗摙摚摛摜摝摟摠摡摢摣摤摥摦摨摪摫摬摮摯摰摱摲摳摴摵摶摷摻摼摽摾摿撀撁撃撆撈撉撊撋撌撍撎撏撐撓撔撗撘撚撛撜撝撟撠撡撢撣撥撦撧撨撪撫撯撱撲撳撴撶撹撻撽撾撿擁擃擄擆擇擈擉擊擋擌擏擑擓擔擕擖擙據�".split("");
	for (j = 0; j != D[147].length; ++j) if (D[147][j].charCodeAt(0) !== 65533) {
		e[D[147][j]] = 37632 + j;
		d[37632 + j] = D[147][j];
	}
	D[148] = "����������������������������������������������������������������擛擜擝擟擠擡擣擥擧擨擩擪擫擬擭擮擯擰擱擲擳擴擵擶擷擸擹擺擻擼擽擾擿攁攂攃攄攅攆攇攈攊攋攌攍攎攏攐攑攓攔攕攖攗攙攚攛攜攝攞攟攠攡�攢攣攤攦攧攨攩攪攬攭攰攱攲攳攷攺攼攽敀敁敂敃敄敆敇敊敋敍敎敐敒敓敔敗敘敚敜敟敠敡敤敥敧敨敩敪敭敮敯敱敳敵敶數敹敺敻敼敽敾敿斀斁斂斃斄斅斆斈斉斊斍斎斏斒斔斕斖斘斚斝斞斠斢斣斦斨斪斬斮斱斲斳斴斵斶斷斸斺斻斾斿旀旂旇旈旉旊旍旐旑旓旔旕旘旙旚旛旜旝旞旟旡旣旤旪旫�".split("");
	for (j = 0; j != D[148].length; ++j) if (D[148][j].charCodeAt(0) !== 65533) {
		e[D[148][j]] = 37888 + j;
		d[37888 + j] = D[148][j];
	}
	D[149] = "����������������������������������������������������������������旲旳旴旵旸旹旻旼旽旾旿昁昄昅昇昈昉昋昍昐昑昒昖昗昘昚昛昜昞昡昢昣昤昦昩昪昫昬昮昰昲昳昷昸昹昺昻昽昿晀時晄晅晆晇晈晉晊晍晎晐晑晘�晙晛晜晝晞晠晢晣晥晧晩晪晫晬晭晱晲晳晵晸晹晻晼晽晿暀暁暃暅暆暈暉暊暋暍暎暏暐暒暓暔暕暘暙暚暛暜暞暟暠暡暢暣暤暥暦暩暪暫暬暭暯暰暱暲暳暵暶暷暸暺暻暼暽暿曀曁曂曃曄曅曆曇曈曉曊曋曌曍曎曏曐曑曒曓曔曕曖曗曘曚曞曟曠曡曢曣曤曥曧曨曪曫曬曭曮曯曱曵曶書曺曻曽朁朂會�".split("");
	for (j = 0; j != D[149].length; ++j) if (D[149][j].charCodeAt(0) !== 65533) {
		e[D[149][j]] = 38144 + j;
		d[38144 + j] = D[149][j];
	}
	D[150] = "����������������������������������������������������������������朄朅朆朇朌朎朏朑朒朓朖朘朙朚朜朞朠朡朢朣朤朥朧朩朮朰朲朳朶朷朸朹朻朼朾朿杁杄杅杇杊杋杍杒杔杕杗杘杙杚杛杝杢杣杤杦杧杫杬杮東杴杶�杸杹杺杻杽枀枂枃枅枆枈枊枌枍枎枏枑枒枓枔枖枙枛枟枠枡枤枦枩枬枮枱枲枴枹枺枻枼枽枾枿柀柂柅柆柇柈柉柊柋柌柍柎柕柖柗柛柟柡柣柤柦柧柨柪柫柭柮柲柵柶柷柸柹柺査柼柾栁栂栃栄栆栍栐栒栔栕栘栙栚栛栜栞栟栠栢栣栤栥栦栧栨栫栬栭栮栯栰栱栴栵栶栺栻栿桇桋桍桏桒桖桗桘桙桚桛�".split("");
	for (j = 0; j != D[150].length; ++j) if (D[150][j].charCodeAt(0) !== 65533) {
		e[D[150][j]] = 38400 + j;
		d[38400 + j] = D[150][j];
	}
	D[151] = "����������������������������������������������������������������桜桝桞桟桪桬桭桮桯桰桱桲桳桵桸桹桺桻桼桽桾桿梀梂梄梇梈梉梊梋梌梍梎梐梑梒梔梕梖梘梙梚梛梜條梞梟梠梡梣梤梥梩梪梫梬梮梱梲梴梶梷梸�梹梺梻梼梽梾梿棁棃棄棅棆棇棈棊棌棎棏棐棑棓棔棖棗棙棛棜棝棞棟棡棢棤棥棦棧棨棩棪棫棬棭棯棲棳棴棶棷棸棻棽棾棿椀椂椃椄椆椇椈椉椊椌椏椑椓椔椕椖椗椘椙椚椛検椝椞椡椢椣椥椦椧椨椩椪椫椬椮椯椱椲椳椵椶椷椸椺椻椼椾楀楁楃楄楅楆楇楈楉楊楋楌楍楎楏楐楑楒楓楕楖楘楙楛楜楟�".split("");
	for (j = 0; j != D[151].length; ++j) if (D[151][j].charCodeAt(0) !== 65533) {
		e[D[151][j]] = 38656 + j;
		d[38656 + j] = D[151][j];
	}
	D[152] = "����������������������������������������������������������������楡楢楤楥楧楨楩楪楬業楯楰楲楳楴極楶楺楻楽楾楿榁榃榅榊榋榌榎榏榐榑榒榓榖榗榙榚榝榞榟榠榡榢榣榤榥榦榩榪榬榮榯榰榲榳榵榶榸榹榺榼榽�榾榿槀槂槃槄槅槆槇槈槉構槍槏槑槒槓槕槖槗様槙槚槜槝槞槡槢槣槤槥槦槧槨槩槪槫槬槮槯槰槱槳槴槵槶槷槸槹槺槻槼槾樀樁樂樃樄樅樆樇樈樉樋樌樍樎樏樐樑樒樓樔樕樖標樚樛樜樝樞樠樢樣樤樥樦樧権樫樬樭樮樰樲樳樴樶樷樸樹樺樻樼樿橀橁橂橃橅橆橈橉橊橋橌橍橎橏橑橒橓橔橕橖橗橚�".split("");
	for (j = 0; j != D[152].length; ++j) if (D[152][j].charCodeAt(0) !== 65533) {
		e[D[152][j]] = 38912 + j;
		d[38912 + j] = D[152][j];
	}
	D[153] = "����������������������������������������������������������������橜橝橞機橠橢橣橤橦橧橨橩橪橫橬橭橮橯橰橲橳橴橵橶橷橸橺橻橽橾橿檁檂檃檅檆檇檈檉檊檋檌檍檏檒檓檔檕檖檘檙檚檛檜檝檞檟檡檢檣檤檥檦�檧檨檪檭檮檯檰檱檲檳檴檵檶檷檸檹檺檻檼檽檾檿櫀櫁櫂櫃櫄櫅櫆櫇櫈櫉櫊櫋櫌櫍櫎櫏櫐櫑櫒櫓櫔櫕櫖櫗櫘櫙櫚櫛櫜櫝櫞櫟櫠櫡櫢櫣櫤櫥櫦櫧櫨櫩櫪櫫櫬櫭櫮櫯櫰櫱櫲櫳櫴櫵櫶櫷櫸櫹櫺櫻櫼櫽櫾櫿欀欁欂欃欄欅欆欇欈欉權欋欌欍欎欏欐欑欒欓欔欕欖欗欘欙欚欛欜欝欞欟欥欦欨欩欪欫欬欭欮�".split("");
	for (j = 0; j != D[153].length; ++j) if (D[153][j].charCodeAt(0) !== 65533) {
		e[D[153][j]] = 39168 + j;
		d[39168 + j] = D[153][j];
	}
	D[154] = "����������������������������������������������������������������欯欰欱欳欴欵欶欸欻欼欽欿歀歁歂歄歅歈歊歋歍歎歏歐歑歒歓歔歕歖歗歘歚歛歜歝歞歟歠歡歨歩歫歬歭歮歯歰歱歲歳歴歵歶歷歸歺歽歾歿殀殅殈�殌殎殏殐殑殔殕殗殘殙殜殝殞殟殠殢殣殤殥殦殧殨殩殫殬殭殮殯殰殱殲殶殸殹殺殻殼殽殾毀毃毄毆毇毈毉毊毌毎毐毑毘毚毜毝毞毟毠毢毣毤毥毦毧毨毩毬毭毮毰毱毲毴毶毷毸毺毻毼毾毿氀氁氂氃氄氈氉氊氋氌氎氒気氜氝氞氠氣氥氫氬氭氱氳氶氷氹氺氻氼氾氿汃汄汅汈汋汌汍汎汏汑汒汓汖汘�".split("");
	for (j = 0; j != D[154].length; ++j) if (D[154][j].charCodeAt(0) !== 65533) {
		e[D[154][j]] = 39424 + j;
		d[39424 + j] = D[154][j];
	}
	D[155] = "����������������������������������������������������������������汙汚汢汣汥汦汧汫汬汭汮汯汱汳汵汷汸決汻汼汿沀沄沇沊沋沍沎沑沒沕沖沗沘沚沜沝沞沠沢沨沬沯沰沴沵沶沷沺泀況泂泃泆泇泈泋泍泎泏泑泒泘�泙泚泜泝泟泤泦泧泩泬泭泲泴泹泿洀洂洃洅洆洈洉洊洍洏洐洑洓洔洕洖洘洜洝洟洠洡洢洣洤洦洨洩洬洭洯洰洴洶洷洸洺洿浀浂浄浉浌浐浕浖浗浘浛浝浟浡浢浤浥浧浨浫浬浭浰浱浲浳浵浶浹浺浻浽浾浿涀涁涃涄涆涇涊涋涍涏涐涒涖涗涘涙涚涜涢涥涬涭涰涱涳涴涶涷涹涺涻涼涽涾淁淂淃淈淉淊�".split("");
	for (j = 0; j != D[155].length; ++j) if (D[155][j].charCodeAt(0) !== 65533) {
		e[D[155][j]] = 39680 + j;
		d[39680 + j] = D[155][j];
	}
	D[156] = "����������������������������������������������������������������淍淎淏淐淒淓淔淕淗淚淛淜淟淢淣淥淧淨淩淪淭淯淰淲淴淵淶淸淺淽淾淿渀渁渂渃渄渆渇済渉渋渏渒渓渕渘渙減渜渞渟渢渦渧渨渪測渮渰渱渳渵�渶渷渹渻渼渽渾渿湀湁湂湅湆湇湈湉湊湋湌湏湐湑湒湕湗湙湚湜湝湞湠湡湢湣湤湥湦湧湨湩湪湬湭湯湰湱湲湳湴湵湶湷湸湹湺湻湼湽満溁溂溄溇溈溊溋溌溍溎溑溒溓溔溕準溗溙溚溛溝溞溠溡溣溤溦溨溩溫溬溭溮溰溳溵溸溹溼溾溿滀滃滄滅滆滈滉滊滌滍滎滐滒滖滘滙滛滜滝滣滧滪滫滬滭滮滯�".split("");
	for (j = 0; j != D[156].length; ++j) if (D[156][j].charCodeAt(0) !== 65533) {
		e[D[156][j]] = 39936 + j;
		d[39936 + j] = D[156][j];
	}
	D[157] = "����������������������������������������������������������������滰滱滲滳滵滶滷滸滺滻滼滽滾滿漀漁漃漄漅漇漈漊漋漌漍漎漐漑漒漖漗漘漙漚漛漜漝漞漟漡漢漣漥漦漧漨漬漮漰漲漴漵漷漸漹漺漻漼漽漿潀潁潂�潃潄潅潈潉潊潌潎潏潐潑潒潓潔潕潖潗潙潚潛潝潟潠潡潣潤潥潧潨潩潪潫潬潯潰潱潳潵潶潷潹潻潽潾潿澀澁澂澃澅澆澇澊澋澏澐澑澒澓澔澕澖澗澘澙澚澛澝澞澟澠澢澣澤澥澦澨澩澪澫澬澭澮澯澰澱澲澴澵澷澸澺澻澼澽澾澿濁濃濄濅濆濇濈濊濋濌濍濎濏濐濓濔濕濖濗濘濙濚濛濜濝濟濢濣濤濥�".split("");
	for (j = 0; j != D[157].length; ++j) if (D[157][j].charCodeAt(0) !== 65533) {
		e[D[157][j]] = 40192 + j;
		d[40192 + j] = D[157][j];
	}
	D[158] = "����������������������������������������������������������������濦濧濨濩濪濫濬濭濰濱濲濳濴濵濶濷濸濹濺濻濼濽濾濿瀀瀁瀂瀃瀄瀅瀆瀇瀈瀉瀊瀋瀌瀍瀎瀏瀐瀒瀓瀔瀕瀖瀗瀘瀙瀜瀝瀞瀟瀠瀡瀢瀤瀥瀦瀧瀨瀩瀪�瀫瀬瀭瀮瀯瀰瀱瀲瀳瀴瀶瀷瀸瀺瀻瀼瀽瀾瀿灀灁灂灃灄灅灆灇灈灉灊灋灍灎灐灑灒灓灔灕灖灗灘灙灚灛灜灝灟灠灡灢灣灤灥灦灧灨灩灪灮灱灲灳灴灷灹灺灻災炁炂炃炄炆炇炈炋炌炍炏炐炑炓炗炘炚炛炞炟炠炡炢炣炤炥炦炧炨炩炪炰炲炴炵炶為炾炿烄烅烆烇烉烋烌烍烎烏烐烑烒烓烔烕烖烗烚�".split("");
	for (j = 0; j != D[158].length; ++j) if (D[158][j].charCodeAt(0) !== 65533) {
		e[D[158][j]] = 40448 + j;
		d[40448 + j] = D[158][j];
	}
	D[159] = "����������������������������������������������������������������烜烝烞烠烡烢烣烥烪烮烰烱烲烳烴烵烶烸烺烻烼烾烿焀焁焂焃焄焅焆焇焈焋焌焍焎焏焑焒焔焗焛焜焝焞焟焠無焢焣焤焥焧焨焩焪焫焬焭焮焲焳焴�焵焷焸焹焺焻焼焽焾焿煀煁煂煃煄煆煇煈煉煋煍煏煐煑煒煓煔煕煖煗煘煙煚煛煝煟煠煡煢煣煥煩煪煫煬煭煯煰煱煴煵煶煷煹煻煼煾煿熀熁熂熃熅熆熇熈熉熋熌熍熎熐熑熒熓熕熖熗熚熛熜熝熞熡熢熣熤熥熦熧熩熪熫熭熮熯熰熱熲熴熶熷熸熺熻熼熽熾熿燀燁燂燄燅燆燇燈燉燊燋燌燍燏燐燑燒燓�".split("");
	for (j = 0; j != D[159].length; ++j) if (D[159][j].charCodeAt(0) !== 65533) {
		e[D[159][j]] = 40704 + j;
		d[40704 + j] = D[159][j];
	}
	D[160] = "����������������������������������������������������������������燖燗燘燙燚燛燜燝燞營燡燢燣燤燦燨燩燪燫燬燭燯燰燱燲燳燴燵燶燷燸燺燻燼燽燾燿爀爁爂爃爄爅爇爈爉爊爋爌爍爎爏爐爑爒爓爔爕爖爗爘爙爚�爛爜爞爟爠爡爢爣爤爥爦爧爩爫爭爮爯爲爳爴爺爼爾牀牁牂牃牄牅牆牉牊牋牎牏牐牑牓牔牕牗牘牚牜牞牠牣牤牥牨牪牫牬牭牰牱牳牴牶牷牸牻牼牽犂犃犅犆犇犈犉犌犎犐犑犓犔犕犖犗犘犙犚犛犜犝犞犠犡犢犣犤犥犦犧犨犩犪犫犮犱犲犳犵犺犻犼犽犾犿狀狅狆狇狉狊狋狌狏狑狓狔狕狖狘狚狛�".split("");
	for (j = 0; j != D[160].length; ++j) if (D[160][j].charCodeAt(0) !== 65533) {
		e[D[160][j]] = 40960 + j;
		d[40960 + j] = D[160][j];
	}
	D[161] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������　、。·ˉˇ¨〃々—～‖…‘’“”〔〕〈〉《》「」『』〖〗【】±×÷∶∧∨∑∏∪∩∈∷√⊥∥∠⌒⊙∫∮≡≌≈∽∝≠≮≯≤≥∞∵∴♂♀°′″℃＄¤￠￡‰§№☆★○●◎◇◆□■△▲※→←↑↓〓�".split("");
	for (j = 0; j != D[161].length; ++j) if (D[161][j].charCodeAt(0) !== 65533) {
		e[D[161][j]] = 41216 + j;
		d[41216 + j] = D[161][j];
	}
	D[162] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ������⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑⒒⒓⒔⒕⒖⒗⒘⒙⒚⒛⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇①②③④⑤⑥⑦⑧⑨⑩��㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩��ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ���".split("");
	for (j = 0; j != D[162].length; ++j) if (D[162][j].charCodeAt(0) !== 65533) {
		e[D[162][j]] = 41472 + j;
		d[41472 + j] = D[162][j];
	}
	D[163] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������！＂＃￥％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝￣�".split("");
	for (j = 0; j != D[163].length; ++j) if (D[163][j].charCodeAt(0) !== 65533) {
		e[D[163][j]] = 41728 + j;
		d[41728 + j] = D[163][j];
	}
	D[164] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをん������������".split("");
	for (j = 0; j != D[164].length; ++j) if (D[164][j].charCodeAt(0) !== 65533) {
		e[D[164][j]] = 41984 + j;
		d[41984 + j] = D[164][j];
	}
	D[165] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ���������".split("");
	for (j = 0; j != D[165].length; ++j) if (D[165][j].charCodeAt(0) !== 65533) {
		e[D[165][j]] = 42240 + j;
		d[42240 + j] = D[165][j];
	}
	D[166] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ��������αβγδεζηθικλμνξοπρστυφχψω�������︵︶︹︺︿﹀︽︾﹁﹂﹃﹄��︻︼︷︸︱�︳︴����������".split("");
	for (j = 0; j != D[166].length; ++j) if (D[166][j].charCodeAt(0) !== 65533) {
		e[D[166][j]] = 42496 + j;
		d[42496 + j] = D[166][j];
	}
	D[167] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ���������������абвгдеёжзийклмнопрстуфхцчшщъыьэюя��������������".split("");
	for (j = 0; j != D[167].length; ++j) if (D[167][j].charCodeAt(0) !== 65533) {
		e[D[167][j]] = 42752 + j;
		d[42752 + j] = D[167][j];
	}
	D[168] = "����������������������������������������������������������������ˊˋ˙–―‥‵℅℉↖↗↘↙∕∟∣≒≦≧⊿═║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬╭╮╯╰╱╲╳▁▂▃▄▅▆▇�█▉▊▋▌▍▎▏▓▔▕▼▽◢◣◤◥☉⊕〒〝〞�����������āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüêɑ�ńň�ɡ����ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ����������������������".split("");
	for (j = 0; j != D[168].length; ++j) if (D[168][j].charCodeAt(0) !== 65533) {
		e[D[168][j]] = 43008 + j;
		d[43008 + j] = D[168][j];
	}
	D[169] = "����������������������������������������������������������������〡〢〣〤〥〦〧〨〩㊣㎎㎏㎜㎝㎞㎡㏄㏎㏑㏒㏕︰￢￤�℡㈱�‐���ー゛゜ヽヾ〆ゝゞ﹉﹊﹋﹌﹍﹎﹏﹐﹑﹒﹔﹕﹖﹗﹙﹚﹛﹜﹝﹞﹟﹠﹡�﹢﹣﹤﹥﹦﹨﹩﹪﹫�������������〇�������������─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋����������������".split("");
	for (j = 0; j != D[169].length; ++j) if (D[169][j].charCodeAt(0) !== 65533) {
		e[D[169][j]] = 43264 + j;
		d[43264 + j] = D[169][j];
	}
	D[170] = "����������������������������������������������������������������狜狝狟狢狣狤狥狦狧狪狫狵狶狹狽狾狿猀猂猄猅猆猇猈猉猋猌猍猏猐猑猒猔猘猙猚猟猠猣猤猦猧猨猭猯猰猲猳猵猶猺猻猼猽獀獁獂獃獄獅獆獇獈�獉獊獋獌獎獏獑獓獔獕獖獘獙獚獛獜獝獞獟獡獢獣獤獥獦獧獨獩獪獫獮獰獱�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[170].length; ++j) if (D[170][j].charCodeAt(0) !== 65533) {
		e[D[170][j]] = 43520 + j;
		d[43520 + j] = D[170][j];
	}
	D[171] = "����������������������������������������������������������������獲獳獴獵獶獷獸獹獺獻獼獽獿玀玁玂玃玅玆玈玊玌玍玏玐玒玓玔玕玗玘玙玚玜玝玞玠玡玣玤玥玦玧玨玪玬玭玱玴玵玶玸玹玼玽玾玿珁珃珄珅珆珇�珋珌珎珒珓珔珕珖珗珘珚珛珜珝珟珡珢珣珤珦珨珪珫珬珮珯珰珱珳珴珵珶珷�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[171].length; ++j) if (D[171][j].charCodeAt(0) !== 65533) {
		e[D[171][j]] = 43776 + j;
		d[43776 + j] = D[171][j];
	}
	D[172] = "����������������������������������������������������������������珸珹珺珻珼珽現珿琀琁琂琄琇琈琋琌琍琎琑琒琓琔琕琖琗琘琙琜琝琞琟琠琡琣琤琧琩琫琭琯琱琲琷琸琹琺琻琽琾琿瑀瑂瑃瑄瑅瑆瑇瑈瑉瑊瑋瑌瑍�瑎瑏瑐瑑瑒瑓瑔瑖瑘瑝瑠瑡瑢瑣瑤瑥瑦瑧瑨瑩瑪瑫瑬瑮瑯瑱瑲瑳瑴瑵瑸瑹瑺�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[172].length; ++j) if (D[172][j].charCodeAt(0) !== 65533) {
		e[D[172][j]] = 44032 + j;
		d[44032 + j] = D[172][j];
	}
	D[173] = "����������������������������������������������������������������瑻瑼瑽瑿璂璄璅璆璈璉璊璌璍璏璑璒璓璔璕璖璗璘璙璚璛璝璟璠璡璢璣璤璥璦璪璫璬璭璮璯環璱璲璳璴璵璶璷璸璹璻璼璽璾璿瓀瓁瓂瓃瓄瓅瓆瓇�瓈瓉瓊瓋瓌瓍瓎瓏瓐瓑瓓瓔瓕瓖瓗瓘瓙瓚瓛瓝瓟瓡瓥瓧瓨瓩瓪瓫瓬瓭瓰瓱瓲�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[173].length; ++j) if (D[173][j].charCodeAt(0) !== 65533) {
		e[D[173][j]] = 44288 + j;
		d[44288 + j] = D[173][j];
	}
	D[174] = "����������������������������������������������������������������瓳瓵瓸瓹瓺瓻瓼瓽瓾甀甁甂甃甅甆甇甈甉甊甋甌甎甐甒甔甕甖甗甛甝甞甠甡產産甤甦甧甪甮甴甶甹甼甽甿畁畂畃畄畆畇畉畊畍畐畑畒畓畕畖畗畘�畝畞畟畠畡畢畣畤畧畨畩畫畬畭畮畯異畱畳畵當畷畺畻畼畽畾疀疁疂疄疅疇�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[174].length; ++j) if (D[174][j].charCodeAt(0) !== 65533) {
		e[D[174][j]] = 44544 + j;
		d[44544 + j] = D[174][j];
	}
	D[175] = "����������������������������������������������������������������疈疉疊疌疍疎疐疓疕疘疛疜疞疢疦疧疨疩疪疭疶疷疺疻疿痀痁痆痋痌痎痏痐痑痓痗痙痚痜痝痟痠痡痥痩痬痭痮痯痲痳痵痶痷痸痺痻痽痾瘂瘄瘆瘇�瘈瘉瘋瘍瘎瘏瘑瘒瘓瘔瘖瘚瘜瘝瘞瘡瘣瘧瘨瘬瘮瘯瘱瘲瘶瘷瘹瘺瘻瘽癁療癄�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[175].length; ++j) if (D[175][j].charCodeAt(0) !== 65533) {
		e[D[175][j]] = 44800 + j;
		d[44800 + j] = D[175][j];
	}
	D[176] = "����������������������������������������������������������������癅癆癇癈癉癊癋癎癏癐癑癒癓癕癗癘癙癚癛癝癟癠癡癢癤癥癦癧癨癩癪癬癭癮癰癱癲癳癴癵癶癷癹発發癿皀皁皃皅皉皊皌皍皏皐皒皔皕皗皘皚皛�皜皝皞皟皠皡皢皣皥皦皧皨皩皪皫皬皭皯皰皳皵皶皷皸皹皺皻皼皽皾盀盁盃啊阿埃挨哎唉哀皑癌蔼矮艾碍爱隘鞍氨安俺按暗岸胺案肮昂盎凹敖熬翱袄傲奥懊澳芭捌扒叭吧笆八疤巴拔跋靶把耙坝霸罢爸白柏百摆佰败拜稗斑班搬扳般颁板版扮拌伴瓣半办绊邦帮梆榜膀绑棒磅蚌镑傍谤苞胞包褒剥�".split("");
	for (j = 0; j != D[176].length; ++j) if (D[176][j].charCodeAt(0) !== 65533) {
		e[D[176][j]] = 45056 + j;
		d[45056 + j] = D[176][j];
	}
	D[177] = "����������������������������������������������������������������盄盇盉盋盌盓盕盙盚盜盝盞盠盡盢監盤盦盧盨盩盪盫盬盭盰盳盵盶盷盺盻盽盿眀眂眃眅眆眊県眎眏眐眑眒眓眔眕眖眗眘眛眜眝眞眡眣眤眥眧眪眫�眬眮眰眱眲眳眴眹眻眽眾眿睂睄睅睆睈睉睊睋睌睍睎睏睒睓睔睕睖睗睘睙睜薄雹保堡饱宝抱报暴豹鲍爆杯碑悲卑北辈背贝钡倍狈备惫焙被奔苯本笨崩绷甭泵蹦迸逼鼻比鄙笔彼碧蓖蔽毕毙毖币庇痹闭敝弊必辟壁臂避陛鞭边编贬扁便变卞辨辩辫遍标彪膘表鳖憋别瘪彬斌濒滨宾摈兵冰柄丙秉饼炳�".split("");
	for (j = 0; j != D[177].length; ++j) if (D[177][j].charCodeAt(0) !== 65533) {
		e[D[177][j]] = 45312 + j;
		d[45312 + j] = D[177][j];
	}
	D[178] = "����������������������������������������������������������������睝睞睟睠睤睧睩睪睭睮睯睰睱睲睳睴睵睶睷睸睺睻睼瞁瞂瞃瞆瞇瞈瞉瞊瞋瞏瞐瞓瞔瞕瞖瞗瞘瞙瞚瞛瞜瞝瞞瞡瞣瞤瞦瞨瞫瞭瞮瞯瞱瞲瞴瞶瞷瞸瞹瞺�瞼瞾矀矁矂矃矄矅矆矇矈矉矊矋矌矎矏矐矑矒矓矔矕矖矘矙矚矝矞矟矠矡矤病并玻菠播拨钵波博勃搏铂箔伯帛舶脖膊渤泊驳捕卜哺补埠不布步簿部怖擦猜裁材才财睬踩采彩菜蔡餐参蚕残惭惨灿苍舱仓沧藏操糙槽曹草厕策侧册测层蹭插叉茬茶查碴搽察岔差诧拆柴豺搀掺蝉馋谗缠铲产阐颤昌猖�".split("");
	for (j = 0; j != D[178].length; ++j) if (D[178][j].charCodeAt(0) !== 65533) {
		e[D[178][j]] = 45568 + j;
		d[45568 + j] = D[178][j];
	}
	D[179] = "����������������������������������������������������������������矦矨矪矯矰矱矲矴矵矷矹矺矻矼砃砄砅砆砇砈砊砋砎砏砐砓砕砙砛砞砠砡砢砤砨砪砫砮砯砱砲砳砵砶砽砿硁硂硃硄硆硈硉硊硋硍硏硑硓硔硘硙硚�硛硜硞硟硠硡硢硣硤硥硦硧硨硩硯硰硱硲硳硴硵硶硸硹硺硻硽硾硿碀碁碂碃场尝常长偿肠厂敞畅唱倡超抄钞朝嘲潮巢吵炒车扯撤掣彻澈郴臣辰尘晨忱沉陈趁衬撑称城橙成呈乘程惩澄诚承逞骋秤吃痴持匙池迟弛驰耻齿侈尺赤翅斥炽充冲虫崇宠抽酬畴踌稠愁筹仇绸瞅丑臭初出橱厨躇锄雏滁除楚�".split("");
	for (j = 0; j != D[179].length; ++j) if (D[179][j].charCodeAt(0) !== 65533) {
		e[D[179][j]] = 45824 + j;
		d[45824 + j] = D[179][j];
	}
	D[180] = "����������������������������������������������������������������碄碅碆碈碊碋碏碐碒碔碕碖碙碝碞碠碢碤碦碨碩碪碫碬碭碮碯碵碶碷碸確碻碼碽碿磀磂磃磄磆磇磈磌磍磎磏磑磒磓磖磗磘磚磛磜磝磞磟磠磡磢磣�磤磥磦磧磩磪磫磭磮磯磰磱磳磵磶磸磹磻磼磽磾磿礀礂礃礄礆礇礈礉礊礋礌础储矗搐触处揣川穿椽传船喘串疮窗幢床闯创吹炊捶锤垂春椿醇唇淳纯蠢戳绰疵茨磁雌辞慈瓷词此刺赐次聪葱囱匆从丛凑粗醋簇促蹿篡窜摧崔催脆瘁粹淬翠村存寸磋撮搓措挫错搭达答瘩打大呆歹傣戴带殆代贷袋待逮�".split("");
	for (j = 0; j != D[180].length; ++j) if (D[180][j].charCodeAt(0) !== 65533) {
		e[D[180][j]] = 46080 + j;
		d[46080 + j] = D[180][j];
	}
	D[181] = "����������������������������������������������������������������礍礎礏礐礑礒礔礕礖礗礘礙礚礛礜礝礟礠礡礢礣礥礦礧礨礩礪礫礬礭礮礯礰礱礲礳礵礶礷礸礹礽礿祂祃祄祅祇祊祋祌祍祎祏祐祑祒祔祕祘祙祡祣�祤祦祩祪祫祬祮祰祱祲祳祴祵祶祹祻祼祽祾祿禂禃禆禇禈禉禋禌禍禎禐禑禒怠耽担丹单郸掸胆旦氮但惮淡诞弹蛋当挡党荡档刀捣蹈倒岛祷导到稻悼道盗德得的蹬灯登等瞪凳邓堤低滴迪敌笛狄涤翟嫡抵底地蒂第帝弟递缔颠掂滇碘点典靛垫电佃甸店惦奠淀殿碉叼雕凋刁掉吊钓调跌爹碟蝶迭谍叠�".split("");
	for (j = 0; j != D[181].length; ++j) if (D[181][j].charCodeAt(0) !== 65533) {
		e[D[181][j]] = 46336 + j;
		d[46336 + j] = D[181][j];
	}
	D[182] = "����������������������������������������������������������������禓禔禕禖禗禘禙禛禜禝禞禟禠禡禢禣禤禥禦禨禩禪禫禬禭禮禯禰禱禲禴禵禶禷禸禼禿秂秄秅秇秈秊秌秎秏秐秓秔秖秗秙秚秛秜秝秞秠秡秢秥秨秪�秬秮秱秲秳秴秵秶秷秹秺秼秾秿稁稄稅稇稈稉稊稌稏稐稑稒稓稕稖稘稙稛稜丁盯叮钉顶鼎锭定订丢东冬董懂动栋侗恫冻洞兜抖斗陡豆逗痘都督毒犊独读堵睹赌杜镀肚度渡妒端短锻段断缎堆兑队对墩吨蹲敦顿囤钝盾遁掇哆多夺垛躲朵跺舵剁惰堕蛾峨鹅俄额讹娥恶厄扼遏鄂饿恩而儿耳尔饵洱二�".split("");
	for (j = 0; j != D[182].length; ++j) if (D[182][j].charCodeAt(0) !== 65533) {
		e[D[182][j]] = 46592 + j;
		d[46592 + j] = D[182][j];
	}
	D[183] = "����������������������������������������������������������������稝稟稡稢稤稥稦稧稨稩稪稫稬稭種稯稰稱稲稴稵稶稸稺稾穀穁穂穃穄穅穇穈穉穊穋穌積穎穏穐穒穓穔穕穖穘穙穚穛穜穝穞穟穠穡穢穣穤穥穦穧穨�穩穪穫穬穭穮穯穱穲穳穵穻穼穽穾窂窅窇窉窊窋窌窎窏窐窓窔窙窚窛窞窡窢贰发罚筏伐乏阀法珐藩帆番翻樊矾钒繁凡烦反返范贩犯饭泛坊芳方肪房防妨仿访纺放菲非啡飞肥匪诽吠肺废沸费芬酚吩氛分纷坟焚汾粉奋份忿愤粪丰封枫蜂峰锋风疯烽逢冯缝讽奉凤佛否夫敷肤孵扶拂辐幅氟符伏俘服�".split("");
	for (j = 0; j != D[183].length; ++j) if (D[183][j].charCodeAt(0) !== 65533) {
		e[D[183][j]] = 46848 + j;
		d[46848 + j] = D[183][j];
	}
	D[184] = "����������������������������������������������������������������窣窤窧窩窪窫窮窯窰窱窲窴窵窶窷窸窹窺窻窼窽窾竀竁竂竃竄竅竆竇竈竉竊竌竍竎竏竐竑竒竓竔竕竗竘竚竛竜竝竡竢竤竧竨竩竪竫竬竮竰竱竲竳�竴竵競竷竸竻竼竾笀笁笂笅笇笉笌笍笎笐笒笓笖笗笘笚笜笝笟笡笢笣笧笩笭浮涪福袱弗甫抚辅俯釜斧脯腑府腐赴副覆赋复傅付阜父腹负富讣附妇缚咐噶嘎该改概钙盖溉干甘杆柑竿肝赶感秆敢赣冈刚钢缸肛纲岗港杠篙皋高膏羔糕搞镐稿告哥歌搁戈鸽胳疙割革葛格蛤阁隔铬个各给根跟耕更庚羹�".split("");
	for (j = 0; j != D[184].length; ++j) if (D[184][j].charCodeAt(0) !== 65533) {
		e[D[184][j]] = 47104 + j;
		d[47104 + j] = D[184][j];
	}
	D[185] = "����������������������������������������������������������������笯笰笲笴笵笶笷笹笻笽笿筀筁筂筃筄筆筈筊筍筎筓筕筗筙筜筞筟筡筣筤筥筦筧筨筩筪筫筬筭筯筰筳筴筶筸筺筼筽筿箁箂箃箄箆箇箈箉箊箋箌箎箏�箑箒箓箖箘箙箚箛箞箟箠箣箤箥箮箯箰箲箳箵箶箷箹箺箻箼箽箾箿節篂篃範埂耿梗工攻功恭龚供躬公宫弓巩汞拱贡共钩勾沟苟狗垢构购够辜菇咕箍估沽孤姑鼓古蛊骨谷股故顾固雇刮瓜剐寡挂褂乖拐怪棺关官冠观管馆罐惯灌贯光广逛瑰规圭硅归龟闺轨鬼诡癸桂柜跪贵刽辊滚棍锅郭国果裹过哈�".split("");
	for (j = 0; j != D[185].length; ++j) if (D[185][j].charCodeAt(0) !== 65533) {
		e[D[185][j]] = 47360 + j;
		d[47360 + j] = D[185][j];
	}
	D[186] = "����������������������������������������������������������������篅篈築篊篋篍篎篏篐篒篔篕篖篗篘篛篜篞篟篠篢篣篤篧篨篩篫篬篭篯篰篲篳篴篵篶篸篹篺篻篽篿簀簁簂簃簄簅簆簈簉簊簍簎簐簑簒簓簔簕簗簘簙�簚簛簜簝簞簠簡簢簣簤簥簨簩簫簬簭簮簯簰簱簲簳簴簵簶簷簹簺簻簼簽簾籂骸孩海氦亥害骇酣憨邯韩含涵寒函喊罕翰撼捍旱憾悍焊汗汉夯杭航壕嚎豪毫郝好耗号浩呵喝荷菏核禾和何合盒貉阂河涸赫褐鹤贺嘿黑痕很狠恨哼亨横衡恒轰哄烘虹鸿洪宏弘红喉侯猴吼厚候后呼乎忽瑚壶葫胡蝴狐糊湖�".split("");
	for (j = 0; j != D[186].length; ++j) if (D[186][j].charCodeAt(0) !== 65533) {
		e[D[186][j]] = 47616 + j;
		d[47616 + j] = D[186][j];
	}
	D[187] = "����������������������������������������������������������������籃籄籅籆籇籈籉籊籋籌籎籏籐籑籒籓籔籕籖籗籘籙籚籛籜籝籞籟籠籡籢籣籤籥籦籧籨籩籪籫籬籭籮籯籰籱籲籵籶籷籸籹籺籾籿粀粁粂粃粄粅粆粇�粈粊粋粌粍粎粏粐粓粔粖粙粚粛粠粡粣粦粧粨粩粫粬粭粯粰粴粵粶粷粸粺粻弧虎唬护互沪户花哗华猾滑画划化话槐徊怀淮坏欢环桓还缓换患唤痪豢焕涣宦幻荒慌黄磺蝗簧皇凰惶煌晃幌恍谎灰挥辉徽恢蛔回毁悔慧卉惠晦贿秽会烩汇讳诲绘荤昏婚魂浑混豁活伙火获或惑霍货祸击圾基机畸稽积箕�".split("");
	for (j = 0; j != D[187].length; ++j) if (D[187][j].charCodeAt(0) !== 65533) {
		e[D[187][j]] = 47872 + j;
		d[47872 + j] = D[187][j];
	}
	D[188] = "����������������������������������������������������������������粿糀糂糃糄糆糉糋糎糏糐糑糒糓糔糘糚糛糝糞糡糢糣糤糥糦糧糩糪糫糬糭糮糰糱糲糳糴糵糶糷糹糺糼糽糾糿紀紁紂紃約紅紆紇紈紉紋紌納紎紏紐�紑紒紓純紕紖紗紘紙級紛紜紝紞紟紡紣紤紥紦紨紩紪紬紭紮細紱紲紳紴紵紶肌饥迹激讥鸡姬绩缉吉极棘辑籍集及急疾汲即嫉级挤几脊己蓟技冀季伎祭剂悸济寄寂计记既忌际妓继纪嘉枷夹佳家加荚颊贾甲钾假稼价架驾嫁歼监坚尖笺间煎兼肩艰奸缄茧检柬碱硷拣捡简俭剪减荐槛鉴践贱见键箭件�".split("");
	for (j = 0; j != D[188].length; ++j) if (D[188][j].charCodeAt(0) !== 65533) {
		e[D[188][j]] = 48128 + j;
		d[48128 + j] = D[188][j];
	}
	D[189] = "����������������������������������������������������������������紷紸紹紺紻紼紽紾紿絀絁終絃組絅絆絇絈絉絊絋経絍絎絏結絑絒絓絔絕絖絗絘絙絚絛絜絝絞絟絠絡絢絣絤絥給絧絨絩絪絫絬絭絯絰統絲絳絴絵絶�絸絹絺絻絼絽絾絿綀綁綂綃綄綅綆綇綈綉綊綋綌綍綎綏綐綑綒經綔綕綖綗綘健舰剑饯渐溅涧建僵姜将浆江疆蒋桨奖讲匠酱降蕉椒礁焦胶交郊浇骄娇嚼搅铰矫侥脚狡角饺缴绞剿教酵轿较叫窖揭接皆秸街阶截劫节桔杰捷睫竭洁结解姐戒藉芥界借介疥诫届巾筋斤金今津襟紧锦仅谨进靳晋禁近烬浸�".split("");
	for (j = 0; j != D[189].length; ++j) if (D[189][j].charCodeAt(0) !== 65533) {
		e[D[189][j]] = 48384 + j;
		d[48384 + j] = D[189][j];
	}
	D[190] = "����������������������������������������������������������������継続綛綜綝綞綟綠綡綢綣綤綥綧綨綩綪綫綬維綯綰綱網綳綴綵綶綷綸綹綺綻綼綽綾綿緀緁緂緃緄緅緆緇緈緉緊緋緌緍緎総緐緑緒緓緔緕緖緗緘緙�線緛緜緝緞緟締緡緢緣緤緥緦緧編緩緪緫緬緭緮緯緰緱緲緳練緵緶緷緸緹緺尽劲荆兢茎睛晶鲸京惊精粳经井警景颈静境敬镜径痉靖竟竞净炯窘揪究纠玖韭久灸九酒厩救旧臼舅咎就疚鞠拘狙疽居驹菊局咀矩举沮聚拒据巨具距踞锯俱句惧炬剧捐鹃娟倦眷卷绢撅攫抉掘倔爵觉决诀绝均菌钧军君峻�".split("");
	for (j = 0; j != D[190].length; ++j) if (D[190][j].charCodeAt(0) !== 65533) {
		e[D[190][j]] = 48640 + j;
		d[48640 + j] = D[190][j];
	}
	D[191] = "����������������������������������������������������������������緻緼緽緾緿縀縁縂縃縄縅縆縇縈縉縊縋縌縍縎縏縐縑縒縓縔縕縖縗縘縙縚縛縜縝縞縟縠縡縢縣縤縥縦縧縨縩縪縫縬縭縮縯縰縱縲縳縴縵縶縷縸縹�縺縼總績縿繀繂繃繄繅繆繈繉繊繋繌繍繎繏繐繑繒繓織繕繖繗繘繙繚繛繜繝俊竣浚郡骏喀咖卡咯开揩楷凯慨刊堪勘坎砍看康慷糠扛抗亢炕考拷烤靠坷苛柯棵磕颗科壳咳可渴克刻客课肯啃垦恳坑吭空恐孔控抠口扣寇枯哭窟苦酷库裤夸垮挎跨胯块筷侩快宽款匡筐狂框矿眶旷况亏盔岿窥葵奎魁傀�".split("");
	for (j = 0; j != D[191].length; ++j) if (D[191][j].charCodeAt(0) !== 65533) {
		e[D[191][j]] = 48896 + j;
		d[48896 + j] = D[191][j];
	}
	D[192] = "����������������������������������������������������������������繞繟繠繡繢繣繤繥繦繧繨繩繪繫繬繭繮繯繰繱繲繳繴繵繶繷繸繹繺繻繼繽繾繿纀纁纃纄纅纆纇纈纉纊纋續纍纎纏纐纑纒纓纔纕纖纗纘纙纚纜纝纞�纮纴纻纼绖绤绬绹缊缐缞缷缹缻缼缽缾缿罀罁罃罆罇罈罉罊罋罌罍罎罏罒罓馈愧溃坤昆捆困括扩廓阔垃拉喇蜡腊辣啦莱来赖蓝婪栏拦篮阑兰澜谰揽览懒缆烂滥琅榔狼廊郎朗浪捞劳牢老佬姥酪烙涝勒乐雷镭蕾磊累儡垒擂肋类泪棱楞冷厘梨犁黎篱狸离漓理李里鲤礼莉荔吏栗丽厉励砾历利傈例俐�".split("");
	for (j = 0; j != D[192].length; ++j) if (D[192][j].charCodeAt(0) !== 65533) {
		e[D[192][j]] = 49152 + j;
		d[49152 + j] = D[192][j];
	}
	D[193] = "����������������������������������������������������������������罖罙罛罜罝罞罠罣罤罥罦罧罫罬罭罯罰罳罵罶罷罸罺罻罼罽罿羀羂羃羄羅羆羇羈羉羋羍羏羐羑羒羓羕羖羗羘羙羛羜羠羢羣羥羦羨義羪羫羬羭羮羱�羳羴羵羶羷羺羻羾翀翂翃翄翆翇翈翉翋翍翏翐翑習翓翖翗翙翚翛翜翝翞翢翣痢立粒沥隶力璃哩俩联莲连镰廉怜涟帘敛脸链恋炼练粮凉梁粱良两辆量晾亮谅撩聊僚疗燎寥辽潦了撂镣廖料列裂烈劣猎琳林磷霖临邻鳞淋凛赁吝拎玲菱零龄铃伶羚凌灵陵岭领另令溜琉榴硫馏留刘瘤流柳六龙聋咙笼窿�".split("");
	for (j = 0; j != D[193].length; ++j) if (D[193][j].charCodeAt(0) !== 65533) {
		e[D[193][j]] = 49408 + j;
		d[49408 + j] = D[193][j];
	}
	D[194] = "����������������������������������������������������������������翤翧翨翪翫翬翭翯翲翴翵翶翷翸翹翺翽翾翿耂耇耈耉耊耎耏耑耓耚耛耝耞耟耡耣耤耫耬耭耮耯耰耲耴耹耺耼耾聀聁聄聅聇聈聉聎聏聐聑聓聕聖聗�聙聛聜聝聞聟聠聡聢聣聤聥聦聧聨聫聬聭聮聯聰聲聳聴聵聶職聸聹聺聻聼聽隆垄拢陇楼娄搂篓漏陋芦卢颅庐炉掳卤虏鲁麓碌露路赂鹿潞禄录陆戮驴吕铝侣旅履屡缕虑氯律率滤绿峦挛孪滦卵乱掠略抡轮伦仑沦纶论萝螺罗逻锣箩骡裸落洛骆络妈麻玛码蚂马骂嘛吗埋买麦卖迈脉瞒馒蛮满蔓曼慢漫�".split("");
	for (j = 0; j != D[194].length; ++j) if (D[194][j].charCodeAt(0) !== 65533) {
		e[D[194][j]] = 49664 + j;
		d[49664 + j] = D[194][j];
	}
	D[195] = "����������������������������������������������������������������聾肁肂肅肈肊肍肎肏肐肑肒肔肕肗肙肞肣肦肧肨肬肰肳肵肶肸肹肻胅胇胈胉胊胋胏胐胑胒胓胔胕胘胟胠胢胣胦胮胵胷胹胻胾胿脀脁脃脄脅脇脈脋�脌脕脗脙脛脜脝脟脠脡脢脣脤脥脦脧脨脩脪脫脭脮脰脳脴脵脷脹脺脻脼脽脿谩芒茫盲氓忙莽猫茅锚毛矛铆卯茂冒帽貌贸么玫枚梅酶霉煤没眉媒镁每美昧寐妹媚门闷们萌蒙檬盟锰猛梦孟眯醚靡糜迷谜弥米秘觅泌蜜密幂棉眠绵冕免勉娩缅面苗描瞄藐秒渺庙妙蔑灭民抿皿敏悯闽明螟鸣铭名命谬摸�".split("");
	for (j = 0; j != D[195].length; ++j) if (D[195][j].charCodeAt(0) !== 65533) {
		e[D[195][j]] = 49920 + j;
		d[49920 + j] = D[195][j];
	}
	D[196] = "����������������������������������������������������������������腀腁腂腃腄腅腇腉腍腎腏腒腖腗腘腛腜腝腞腟腡腢腣腤腦腨腪腫腬腯腲腳腵腶腷腸膁膃膄膅膆膇膉膋膌膍膎膐膒膓膔膕膖膗膙膚膞膟膠膡膢膤膥�膧膩膫膬膭膮膯膰膱膲膴膵膶膷膸膹膼膽膾膿臄臅臇臈臉臋臍臎臏臐臑臒臓摹蘑模膜磨摩魔抹末莫墨默沫漠寞陌谋牟某拇牡亩姆母墓暮幕募慕木目睦牧穆拿哪呐钠那娜纳氖乃奶耐奈南男难囊挠脑恼闹淖呢馁内嫩能妮霓倪泥尼拟你匿腻逆溺蔫拈年碾撵捻念娘酿鸟尿捏聂孽啮镊镍涅您柠狞凝宁�".split("");
	for (j = 0; j != D[196].length; ++j) if (D[196][j].charCodeAt(0) !== 65533) {
		e[D[196][j]] = 50176 + j;
		d[50176 + j] = D[196][j];
	}
	D[197] = "����������������������������������������������������������������臔臕臖臗臘臙臚臛臜臝臞臟臠臡臢臤臥臦臨臩臫臮臯臰臱臲臵臶臷臸臹臺臽臿舃與興舉舊舋舎舏舑舓舕舖舗舘舙舚舝舠舤舥舦舧舩舮舲舺舼舽舿�艀艁艂艃艅艆艈艊艌艍艎艐艑艒艓艔艕艖艗艙艛艜艝艞艠艡艢艣艤艥艦艧艩拧泞牛扭钮纽脓浓农弄奴努怒女暖虐疟挪懦糯诺哦欧鸥殴藕呕偶沤啪趴爬帕怕琶拍排牌徘湃派攀潘盘磐盼畔判叛乓庞旁耪胖抛咆刨炮袍跑泡呸胚培裴赔陪配佩沛喷盆砰抨烹澎彭蓬棚硼篷膨朋鹏捧碰坯砒霹批披劈琵毗�".split("");
	for (j = 0; j != D[197].length; ++j) if (D[197][j].charCodeAt(0) !== 65533) {
		e[D[197][j]] = 50432 + j;
		d[50432 + j] = D[197][j];
	}
	D[198] = "����������������������������������������������������������������艪艫艬艭艱艵艶艷艸艻艼芀芁芃芅芆芇芉芌芐芓芔芕芖芚芛芞芠芢芣芧芲芵芶芺芻芼芿苀苂苃苅苆苉苐苖苙苚苝苢苧苨苩苪苬苭苮苰苲苳苵苶苸�苺苼苽苾苿茀茊茋茍茐茒茓茖茘茙茝茞茟茠茡茢茣茤茥茦茩茪茮茰茲茷茻茽啤脾疲皮匹痞僻屁譬篇偏片骗飘漂瓢票撇瞥拼频贫品聘乒坪苹萍平凭瓶评屏坡泼颇婆破魄迫粕剖扑铺仆莆葡菩蒲埔朴圃普浦谱曝瀑期欺栖戚妻七凄漆柒沏其棋奇歧畦崎脐齐旗祈祁骑起岂乞企启契砌器气迄弃汽泣讫掐�".split("");
	for (j = 0; j != D[198].length; ++j) if (D[198][j].charCodeAt(0) !== 65533) {
		e[D[198][j]] = 50688 + j;
		d[50688 + j] = D[198][j];
	}
	D[199] = "����������������������������������������������������������������茾茿荁荂荄荅荈荊荋荌荍荎荓荕荖荗荘荙荝荢荰荱荲荳荴荵荶荹荺荾荿莀莁莂莃莄莇莈莊莋莌莍莏莐莑莔莕莖莗莙莚莝莟莡莢莣莤莥莦莧莬莭莮�莯莵莻莾莿菂菃菄菆菈菉菋菍菎菐菑菒菓菕菗菙菚菛菞菢菣菤菦菧菨菫菬菭恰洽牵扦钎铅千迁签仟谦乾黔钱钳前潜遣浅谴堑嵌欠歉枪呛腔羌墙蔷强抢橇锹敲悄桥瞧乔侨巧鞘撬翘峭俏窍切茄且怯窃钦侵亲秦琴勤芹擒禽寝沁青轻氢倾卿清擎晴氰情顷请庆琼穷秋丘邱球求囚酋泅趋区蛆曲躯屈驱渠�".split("");
	for (j = 0; j != D[199].length; ++j) if (D[199][j].charCodeAt(0) !== 65533) {
		e[D[199][j]] = 50944 + j;
		d[50944 + j] = D[199][j];
	}
	D[200] = "����������������������������������������������������������������菮華菳菴菵菶菷菺菻菼菾菿萀萂萅萇萈萉萊萐萒萓萔萕萖萗萙萚萛萞萟萠萡萢萣萩萪萫萬萭萮萯萰萲萳萴萵萶萷萹萺萻萾萿葀葁葂葃葄葅葇葈葉�葊葋葌葍葎葏葐葒葓葔葕葖葘葝葞葟葠葢葤葥葦葧葨葪葮葯葰葲葴葷葹葻葼取娶龋趣去圈颧权醛泉全痊拳犬券劝缺炔瘸却鹊榷确雀裙群然燃冉染瓤壤攘嚷让饶扰绕惹热壬仁人忍韧任认刃妊纫扔仍日戎茸蓉荣融熔溶容绒冗揉柔肉茹蠕儒孺如辱乳汝入褥软阮蕊瑞锐闰润若弱撒洒萨腮鳃塞赛三叁�".split("");
	for (j = 0; j != D[200].length; ++j) if (D[200][j].charCodeAt(0) !== 65533) {
		e[D[200][j]] = 51200 + j;
		d[51200 + j] = D[200][j];
	}
	D[201] = "����������������������������������������������������������������葽葾葿蒀蒁蒃蒄蒅蒆蒊蒍蒏蒐蒑蒒蒓蒔蒕蒖蒘蒚蒛蒝蒞蒟蒠蒢蒣蒤蒥蒦蒧蒨蒩蒪蒫蒬蒭蒮蒰蒱蒳蒵蒶蒷蒻蒼蒾蓀蓂蓃蓅蓆蓇蓈蓋蓌蓎蓏蓒蓔蓕蓗�蓘蓙蓚蓛蓜蓞蓡蓢蓤蓧蓨蓩蓪蓫蓭蓮蓯蓱蓲蓳蓴蓵蓶蓷蓸蓹蓺蓻蓽蓾蔀蔁蔂伞散桑嗓丧搔骚扫嫂瑟色涩森僧莎砂杀刹沙纱傻啥煞筛晒珊苫杉山删煽衫闪陕擅赡膳善汕扇缮墒伤商赏晌上尚裳梢捎稍烧芍勺韶少哨邵绍奢赊蛇舌舍赦摄射慑涉社设砷申呻伸身深娠绅神沈审婶甚肾慎渗声生甥牲升绳�".split("");
	for (j = 0; j != D[201].length; ++j) if (D[201][j].charCodeAt(0) !== 65533) {
		e[D[201][j]] = 51456 + j;
		d[51456 + j] = D[201][j];
	}
	D[202] = "����������������������������������������������������������������蔃蔄蔅蔆蔇蔈蔉蔊蔋蔍蔎蔏蔐蔒蔔蔕蔖蔘蔙蔛蔜蔝蔞蔠蔢蔣蔤蔥蔦蔧蔨蔩蔪蔭蔮蔯蔰蔱蔲蔳蔴蔵蔶蔾蔿蕀蕁蕂蕄蕅蕆蕇蕋蕌蕍蕎蕏蕐蕑蕒蕓蕔蕕�蕗蕘蕚蕛蕜蕝蕟蕠蕡蕢蕣蕥蕦蕧蕩蕪蕫蕬蕭蕮蕯蕰蕱蕳蕵蕶蕷蕸蕼蕽蕿薀薁省盛剩胜圣师失狮施湿诗尸虱十石拾时什食蚀实识史矢使屎驶始式示士世柿事拭誓逝势是嗜噬适仕侍释饰氏市恃室视试收手首守寿授售受瘦兽蔬枢梳殊抒输叔舒淑疏书赎孰熟薯暑曙署蜀黍鼠属术述树束戍竖墅庶数漱�".split("");
	for (j = 0; j != D[202].length; ++j) if (D[202][j].charCodeAt(0) !== 65533) {
		e[D[202][j]] = 51712 + j;
		d[51712 + j] = D[202][j];
	}
	D[203] = "����������������������������������������������������������������薂薃薆薈薉薊薋薌薍薎薐薑薒薓薔薕薖薗薘薙薚薝薞薟薠薡薢薣薥薦薧薩薫薬薭薱薲薳薴薵薶薸薺薻薼薽薾薿藀藂藃藄藅藆藇藈藊藋藌藍藎藑藒�藔藖藗藘藙藚藛藝藞藟藠藡藢藣藥藦藧藨藪藫藬藭藮藯藰藱藲藳藴藵藶藷藸恕刷耍摔衰甩帅栓拴霜双爽谁水睡税吮瞬顺舜说硕朔烁斯撕嘶思私司丝死肆寺嗣四伺似饲巳松耸怂颂送宋讼诵搜艘擞嗽苏酥俗素速粟僳塑溯宿诉肃酸蒜算虽隋随绥髓碎岁穗遂隧祟孙损笋蓑梭唆缩琐索锁所塌他它她塔�".split("");
	for (j = 0; j != D[203].length; ++j) if (D[203][j].charCodeAt(0) !== 65533) {
		e[D[203][j]] = 51968 + j;
		d[51968 + j] = D[203][j];
	}
	D[204] = "����������������������������������������������������������������藹藺藼藽藾蘀蘁蘂蘃蘄蘆蘇蘈蘉蘊蘋蘌蘍蘎蘏蘐蘒蘓蘔蘕蘗蘘蘙蘚蘛蘜蘝蘞蘟蘠蘡蘢蘣蘤蘥蘦蘨蘪蘫蘬蘭蘮蘯蘰蘱蘲蘳蘴蘵蘶蘷蘹蘺蘻蘽蘾蘿虀�虁虂虃虄虅虆虇虈虉虊虋虌虒虓處虖虗虘虙虛虜虝號虠虡虣虤虥虦虧虨虩虪獭挞蹋踏胎苔抬台泰酞太态汰坍摊贪瘫滩坛檀痰潭谭谈坦毯袒碳探叹炭汤塘搪堂棠膛唐糖倘躺淌趟烫掏涛滔绦萄桃逃淘陶讨套特藤腾疼誊梯剔踢锑提题蹄啼体替嚏惕涕剃屉天添填田甜恬舔腆挑条迢眺跳贴铁帖厅听烃�".split("");
	for (j = 0; j != D[204].length; ++j) if (D[204][j].charCodeAt(0) !== 65533) {
		e[D[204][j]] = 52224 + j;
		d[52224 + j] = D[204][j];
	}
	D[205] = "����������������������������������������������������������������虭虯虰虲虳虴虵虶虷虸蚃蚄蚅蚆蚇蚈蚉蚎蚏蚐蚑蚒蚔蚖蚗蚘蚙蚚蚛蚞蚟蚠蚡蚢蚥蚦蚫蚭蚮蚲蚳蚷蚸蚹蚻蚼蚽蚾蚿蛁蛂蛃蛅蛈蛌蛍蛒蛓蛕蛖蛗蛚蛜�蛝蛠蛡蛢蛣蛥蛦蛧蛨蛪蛫蛬蛯蛵蛶蛷蛺蛻蛼蛽蛿蜁蜄蜅蜆蜋蜌蜎蜏蜐蜑蜔蜖汀廷停亭庭挺艇通桐酮瞳同铜彤童桶捅筒统痛偷投头透凸秃突图徒途涂屠土吐兔湍团推颓腿蜕褪退吞屯臀拖托脱鸵陀驮驼椭妥拓唾挖哇蛙洼娃瓦袜歪外豌弯湾玩顽丸烷完碗挽晚皖惋宛婉万腕汪王亡枉网往旺望忘妄威�".split("");
	for (j = 0; j != D[205].length; ++j) if (D[205][j].charCodeAt(0) !== 65533) {
		e[D[205][j]] = 52480 + j;
		d[52480 + j] = D[205][j];
	}
	D[206] = "����������������������������������������������������������������蜙蜛蜝蜟蜠蜤蜦蜧蜨蜪蜫蜬蜭蜯蜰蜲蜳蜵蜶蜸蜹蜺蜼蜽蝀蝁蝂蝃蝄蝅蝆蝊蝋蝍蝏蝐蝑蝒蝔蝕蝖蝘蝚蝛蝜蝝蝞蝟蝡蝢蝦蝧蝨蝩蝪蝫蝬蝭蝯蝱蝲蝳蝵�蝷蝸蝹蝺蝿螀螁螄螆螇螉螊螌螎螏螐螑螒螔螕螖螘螙螚螛螜螝螞螠螡螢螣螤巍微危韦违桅围唯惟为潍维苇萎委伟伪尾纬未蔚味畏胃喂魏位渭谓尉慰卫瘟温蚊文闻纹吻稳紊问嗡翁瓮挝蜗涡窝我斡卧握沃巫呜钨乌污诬屋无芜梧吾吴毋武五捂午舞伍侮坞戊雾晤物勿务悟误昔熙析西硒矽晰嘻吸锡牺�".split("");
	for (j = 0; j != D[206].length; ++j) if (D[206][j].charCodeAt(0) !== 65533) {
		e[D[206][j]] = 52736 + j;
		d[52736 + j] = D[206][j];
	}
	D[207] = "����������������������������������������������������������������螥螦螧螩螪螮螰螱螲螴螶螷螸螹螻螼螾螿蟁蟂蟃蟄蟅蟇蟈蟉蟌蟍蟎蟏蟐蟔蟕蟖蟗蟘蟙蟚蟜蟝蟞蟟蟡蟢蟣蟤蟦蟧蟨蟩蟫蟬蟭蟯蟰蟱蟲蟳蟴蟵蟶蟷蟸�蟺蟻蟼蟽蟿蠀蠁蠂蠄蠅蠆蠇蠈蠉蠋蠌蠍蠎蠏蠐蠑蠒蠔蠗蠘蠙蠚蠜蠝蠞蠟蠠蠣稀息希悉膝夕惜熄烯溪汐犀檄袭席习媳喜铣洗系隙戏细瞎虾匣霞辖暇峡侠狭下厦夏吓掀锨先仙鲜纤咸贤衔舷闲涎弦嫌显险现献县腺馅羡宪陷限线相厢镶香箱襄湘乡翔祥详想响享项巷橡像向象萧硝霄削哮嚣销消宵淆晓�".split("");
	for (j = 0; j != D[207].length; ++j) if (D[207][j].charCodeAt(0) !== 65533) {
		e[D[207][j]] = 52992 + j;
		d[52992 + j] = D[207][j];
	}
	D[208] = "����������������������������������������������������������������蠤蠥蠦蠧蠨蠩蠪蠫蠬蠭蠮蠯蠰蠱蠳蠴蠵蠶蠷蠸蠺蠻蠽蠾蠿衁衂衃衆衇衈衉衊衋衎衏衐衑衒術衕衖衘衚衛衜衝衞衟衠衦衧衪衭衯衱衳衴衵衶衸衹衺�衻衼袀袃袆袇袉袊袌袎袏袐袑袓袔袕袗袘袙袚袛袝袞袟袠袡袣袥袦袧袨袩袪小孝校肖啸笑效楔些歇蝎鞋协挟携邪斜胁谐写械卸蟹懈泄泻谢屑薪芯锌欣辛新忻心信衅星腥猩惺兴刑型形邢行醒幸杏性姓兄凶胸匈汹雄熊休修羞朽嗅锈秀袖绣墟戌需虚嘘须徐许蓄酗叙旭序畜恤絮婿绪续轩喧宣悬旋玄�".split("");
	for (j = 0; j != D[208].length; ++j) if (D[208][j].charCodeAt(0) !== 65533) {
		e[D[208][j]] = 53248 + j;
		d[53248 + j] = D[208][j];
	}
	D[209] = "����������������������������������������������������������������袬袮袯袰袲袳袴袵袶袸袹袺袻袽袾袿裀裃裄裇裈裊裋裌裍裏裐裑裓裖裗裚裛補裝裞裠裡裦裧裩裪裫裬裭裮裯裲裵裶裷裺裻製裿褀褁褃褄褅褆複褈�褉褋褌褍褎褏褑褔褕褖褗褘褜褝褞褟褠褢褣褤褦褧褨褩褬褭褮褯褱褲褳褵褷选癣眩绚靴薛学穴雪血勋熏循旬询寻驯巡殉汛训讯逊迅压押鸦鸭呀丫芽牙蚜崖衙涯雅哑亚讶焉咽阉烟淹盐严研蜒岩延言颜阎炎沿奄掩眼衍演艳堰燕厌砚雁唁彦焰宴谚验殃央鸯秧杨扬佯疡羊洋阳氧仰痒养样漾邀腰妖瑶�".split("");
	for (j = 0; j != D[209].length; ++j) if (D[209][j].charCodeAt(0) !== 65533) {
		e[D[209][j]] = 53504 + j;
		d[53504 + j] = D[209][j];
	}
	D[210] = "����������������������������������������������������������������褸褹褺褻褼褽褾褿襀襂襃襅襆襇襈襉襊襋襌襍襎襏襐襑襒襓襔襕襖襗襘襙襚襛襜襝襠襡襢襣襤襥襧襨襩襪襫襬襭襮襯襰襱襲襳襴襵襶襷襸襹襺襼�襽襾覀覂覄覅覇覈覉覊見覌覍覎規覐覑覒覓覔覕視覗覘覙覚覛覜覝覞覟覠覡摇尧遥窑谣姚咬舀药要耀椰噎耶爷野冶也页掖业叶曳腋夜液一壹医揖铱依伊衣颐夷遗移仪胰疑沂宜姨彝椅蚁倚已乙矣以艺抑易邑屹亿役臆逸肄疫亦裔意毅忆义益溢诣议谊译异翼翌绎茵荫因殷音阴姻吟银淫寅饮尹引隐�".split("");
	for (j = 0; j != D[210].length; ++j) if (D[210][j].charCodeAt(0) !== 65533) {
		e[D[210][j]] = 53760 + j;
		d[53760 + j] = D[210][j];
	}
	D[211] = "����������������������������������������������������������������覢覣覤覥覦覧覨覩親覫覬覭覮覯覰覱覲観覴覵覶覷覸覹覺覻覼覽覾覿觀觃觍觓觔觕觗觘觙觛觝觟觠觡觢觤觧觨觩觪觬觭觮觰觱觲觴觵觶觷觸觹觺�觻觼觽觾觿訁訂訃訄訅訆計訉訊訋訌訍討訏訐訑訒訓訔訕訖託記訙訚訛訜訝印英樱婴鹰应缨莹萤营荧蝇迎赢盈影颖硬映哟拥佣臃痈庸雍踊蛹咏泳涌永恿勇用幽优悠忧尤由邮铀犹油游酉有友右佑釉诱又幼迂淤于盂榆虞愚舆余俞逾鱼愉渝渔隅予娱雨与屿禹宇语羽玉域芋郁吁遇喻峪御愈欲狱育誉�".split("");
	for (j = 0; j != D[211].length; ++j) if (D[211][j].charCodeAt(0) !== 65533) {
		e[D[211][j]] = 54016 + j;
		d[54016 + j] = D[211][j];
	}
	D[212] = "����������������������������������������������������������������訞訟訠訡訢訣訤訥訦訧訨訩訪訫訬設訮訯訰許訲訳訴訵訶訷訸訹診註証訽訿詀詁詂詃詄詅詆詇詉詊詋詌詍詎詏詐詑詒詓詔評詖詗詘詙詚詛詜詝詞�詟詠詡詢詣詤詥試詧詨詩詪詫詬詭詮詯詰話該詳詴詵詶詷詸詺詻詼詽詾詿誀浴寓裕预豫驭鸳渊冤元垣袁原援辕园员圆猿源缘远苑愿怨院曰约越跃钥岳粤月悦阅耘云郧匀陨允运蕴酝晕韵孕匝砸杂栽哉灾宰载再在咱攒暂赞赃脏葬遭糟凿藻枣早澡蚤躁噪造皂灶燥责择则泽贼怎增憎曾赠扎喳渣札轧�".split("");
	for (j = 0; j != D[212].length; ++j) if (D[212][j].charCodeAt(0) !== 65533) {
		e[D[212][j]] = 54272 + j;
		d[54272 + j] = D[212][j];
	}
	D[213] = "����������������������������������������������������������������誁誂誃誄誅誆誇誈誋誌認誎誏誐誑誒誔誕誖誗誘誙誚誛誜誝語誟誠誡誢誣誤誥誦誧誨誩說誫説読誮誯誰誱課誳誴誵誶誷誸誹誺誻誼誽誾調諀諁諂�諃諄諅諆談諈諉諊請諌諍諎諏諐諑諒諓諔諕論諗諘諙諚諛諜諝諞諟諠諡諢諣铡闸眨栅榨咋乍炸诈摘斋宅窄债寨瞻毡詹粘沾盏斩辗崭展蘸栈占战站湛绽樟章彰漳张掌涨杖丈帐账仗胀瘴障招昭找沼赵照罩兆肇召遮折哲蛰辙者锗蔗这浙珍斟真甄砧臻贞针侦枕疹诊震振镇阵蒸挣睁征狰争怔整拯正政�".split("");
	for (j = 0; j != D[213].length; ++j) if (D[213][j].charCodeAt(0) !== 65533) {
		e[D[213][j]] = 54528 + j;
		d[54528 + j] = D[213][j];
	}
	D[214] = "����������������������������������������������������������������諤諥諦諧諨諩諪諫諬諭諮諯諰諱諲諳諴諵諶諷諸諹諺諻諼諽諾諿謀謁謂謃謄謅謆謈謉謊謋謌謍謎謏謐謑謒謓謔謕謖謗謘謙謚講謜謝謞謟謠謡謢謣�謤謥謧謨謩謪謫謬謭謮謯謰謱謲謳謴謵謶謷謸謹謺謻謼謽謾謿譀譁譂譃譄譅帧症郑证芝枝支吱蜘知肢脂汁之织职直植殖执值侄址指止趾只旨纸志挚掷至致置帜峙制智秩稚质炙痔滞治窒中盅忠钟衷终种肿重仲众舟周州洲诌粥轴肘帚咒皱宙昼骤珠株蛛朱猪诸诛逐竹烛煮拄瞩嘱主著柱助蛀贮铸筑�".split("");
	for (j = 0; j != D[214].length; ++j) if (D[214][j].charCodeAt(0) !== 65533) {
		e[D[214][j]] = 54784 + j;
		d[54784 + j] = D[214][j];
	}
	D[215] = "����������������������������������������������������������������譆譇譈證譊譋譌譍譎譏譐譑譒譓譔譕譖譗識譙譚譛譜譝譞譟譠譡譢譣譤譥譧譨譩譪譫譭譮譯議譱譲譳譴譵譶護譸譹譺譻譼譽譾譿讀讁讂讃讄讅讆�讇讈讉變讋讌讍讎讏讐讑讒讓讔讕讖讗讘讙讚讛讜讝讞讟讬讱讻诇诐诪谉谞住注祝驻抓爪拽专砖转撰赚篆桩庄装妆撞壮状椎锥追赘坠缀谆准捉拙卓桌琢茁酌啄着灼浊兹咨资姿滋淄孜紫仔籽滓子自渍字鬃棕踪宗综总纵邹走奏揍租足卒族祖诅阻组钻纂嘴醉最罪尊遵昨左佐柞做作坐座������".split("");
	for (j = 0; j != D[215].length; ++j) if (D[215][j].charCodeAt(0) !== 65533) {
		e[D[215][j]] = 55040 + j;
		d[55040 + j] = D[215][j];
	}
	D[216] = "����������������������������������������������������������������谸谹谺谻谼谽谾谿豀豂豃豄豅豈豊豋豍豎豏豐豑豒豓豔豖豗豘豙豛豜豝豞豟豠豣豤豥豦豧豨豩豬豭豮豯豰豱豲豴豵豶豷豻豼豽豾豿貀貁貃貄貆貇�貈貋貍貎貏貐貑貒貓貕貖貗貙貚貛貜貝貞貟負財貢貣貤貥貦貧貨販貪貫責貭亍丌兀丐廿卅丕亘丞鬲孬噩丨禺丿匕乇夭爻卮氐囟胤馗毓睾鼗丶亟鼐乜乩亓芈孛啬嘏仄厍厝厣厥厮靥赝匚叵匦匮匾赜卦卣刂刈刎刭刳刿剀剌剞剡剜蒯剽劂劁劐劓冂罔亻仃仉仂仨仡仫仞伛仳伢佤仵伥伧伉伫佞佧攸佚佝�".split("");
	for (j = 0; j != D[216].length; ++j) if (D[216][j].charCodeAt(0) !== 65533) {
		e[D[216][j]] = 55296 + j;
		d[55296 + j] = D[216][j];
	}
	D[217] = "����������������������������������������������������������������貮貯貰貱貲貳貴貵貶買貸貹貺費貼貽貾貿賀賁賂賃賄賅賆資賈賉賊賋賌賍賎賏賐賑賒賓賔賕賖賗賘賙賚賛賜賝賞賟賠賡賢賣賤賥賦賧賨賩質賫賬�賭賮賯賰賱賲賳賴賵賶賷賸賹賺賻購賽賾賿贀贁贂贃贄贅贆贇贈贉贊贋贌贍佟佗伲伽佶佴侑侉侃侏佾佻侪佼侬侔俦俨俪俅俚俣俜俑俟俸倩偌俳倬倏倮倭俾倜倌倥倨偾偃偕偈偎偬偻傥傧傩傺僖儆僭僬僦僮儇儋仝氽佘佥俎龠汆籴兮巽黉馘冁夔勹匍訇匐凫夙兕亠兖亳衮袤亵脔裒禀嬴蠃羸冫冱冽冼�".split("");
	for (j = 0; j != D[217].length; ++j) if (D[217][j].charCodeAt(0) !== 65533) {
		e[D[217][j]] = 55552 + j;
		d[55552 + j] = D[217][j];
	}
	D[218] = "����������������������������������������������������������������贎贏贐贑贒贓贔贕贖贗贘贙贚贛贜贠赑赒赗赟赥赨赩赪赬赮赯赱赲赸赹赺赻赼赽赾赿趀趂趃趆趇趈趉趌趍趎趏趐趒趓趕趖趗趘趙趚趛趜趝趞趠趡�趢趤趥趦趧趨趩趪趫趬趭趮趯趰趲趶趷趹趻趽跀跁跂跅跇跈跉跊跍跐跒跓跔凇冖冢冥讠讦讧讪讴讵讷诂诃诋诏诎诒诓诔诖诘诙诜诟诠诤诨诩诮诰诳诶诹诼诿谀谂谄谇谌谏谑谒谔谕谖谙谛谘谝谟谠谡谥谧谪谫谮谯谲谳谵谶卩卺阝阢阡阱阪阽阼陂陉陔陟陧陬陲陴隈隍隗隰邗邛邝邙邬邡邴邳邶邺�".split("");
	for (j = 0; j != D[218].length; ++j) if (D[218][j].charCodeAt(0) !== 65533) {
		e[D[218][j]] = 55808 + j;
		d[55808 + j] = D[218][j];
	}
	D[219] = "����������������������������������������������������������������跕跘跙跜跠跡跢跥跦跧跩跭跮跰跱跲跴跶跼跾跿踀踁踂踃踄踆踇踈踋踍踎踐踑踒踓踕踖踗踘踙踚踛踜踠踡踤踥踦踧踨踫踭踰踲踳踴踶踷踸踻踼踾�踿蹃蹅蹆蹌蹍蹎蹏蹐蹓蹔蹕蹖蹗蹘蹚蹛蹜蹝蹞蹟蹠蹡蹢蹣蹤蹥蹧蹨蹪蹫蹮蹱邸邰郏郅邾郐郄郇郓郦郢郜郗郛郫郯郾鄄鄢鄞鄣鄱鄯鄹酃酆刍奂劢劬劭劾哿勐勖勰叟燮矍廴凵凼鬯厶弁畚巯坌垩垡塾墼壅壑圩圬圪圳圹圮圯坜圻坂坩垅坫垆坼坻坨坭坶坳垭垤垌垲埏垧垴垓垠埕埘埚埙埒垸埴埯埸埤埝�".split("");
	for (j = 0; j != D[219].length; ++j) if (D[219][j].charCodeAt(0) !== 65533) {
		e[D[219][j]] = 56064 + j;
		d[56064 + j] = D[219][j];
	}
	D[220] = "����������������������������������������������������������������蹳蹵蹷蹸蹹蹺蹻蹽蹾躀躂躃躄躆躈躉躊躋躌躍躎躑躒躓躕躖躗躘躙躚躛躝躟躠躡躢躣躤躥躦躧躨躩躪躭躮躰躱躳躴躵躶躷躸躹躻躼躽躾躿軀軁軂�軃軄軅軆軇軈軉車軋軌軍軏軐軑軒軓軔軕軖軗軘軙軚軛軜軝軞軟軠軡転軣軤堋堍埽埭堀堞堙塄堠塥塬墁墉墚墀馨鼙懿艹艽艿芏芊芨芄芎芑芗芙芫芸芾芰苈苊苣芘芷芮苋苌苁芩芴芡芪芟苄苎芤苡茉苷苤茏茇苜苴苒苘茌苻苓茑茚茆茔茕苠苕茜荑荛荜茈莒茼茴茱莛荞茯荏荇荃荟荀茗荠茭茺茳荦荥�".split("");
	for (j = 0; j != D[220].length; ++j) if (D[220][j].charCodeAt(0) !== 65533) {
		e[D[220][j]] = 56320 + j;
		d[56320 + j] = D[220][j];
	}
	D[221] = "����������������������������������������������������������������軥軦軧軨軩軪軫軬軭軮軯軰軱軲軳軴軵軶軷軸軹軺軻軼軽軾軿輀輁輂較輄輅輆輇輈載輊輋輌輍輎輏輐輑輒輓輔輕輖輗輘輙輚輛輜輝輞輟輠輡輢輣�輤輥輦輧輨輩輪輫輬輭輮輯輰輱輲輳輴輵輶輷輸輹輺輻輼輽輾輿轀轁轂轃轄荨茛荩荬荪荭荮莰荸莳莴莠莪莓莜莅荼莶莩荽莸荻莘莞莨莺莼菁萁菥菘堇萘萋菝菽菖萜萸萑萆菔菟萏萃菸菹菪菅菀萦菰菡葜葑葚葙葳蒇蒈葺蒉葸萼葆葩葶蒌蒎萱葭蓁蓍蓐蓦蒽蓓蓊蒿蒺蓠蒡蒹蒴蒗蓥蓣蔌甍蔸蓰蔹蔟蔺�".split("");
	for (j = 0; j != D[221].length; ++j) if (D[221][j].charCodeAt(0) !== 65533) {
		e[D[221][j]] = 56576 + j;
		d[56576 + j] = D[221][j];
	}
	D[222] = "����������������������������������������������������������������轅轆轇轈轉轊轋轌轍轎轏轐轑轒轓轔轕轖轗轘轙轚轛轜轝轞轟轠轡轢轣轤轥轪辀辌辒辝辠辡辢辤辥辦辧辪辬辭辮辯農辳辴辵辷辸辺辻込辿迀迃迆�迉迊迋迌迍迏迒迖迗迚迠迡迣迧迬迯迱迲迴迵迶迺迻迼迾迿逇逈逌逎逓逕逘蕖蔻蓿蓼蕙蕈蕨蕤蕞蕺瞢蕃蕲蕻薤薨薇薏蕹薮薜薅薹薷薰藓藁藜藿蘧蘅蘩蘖蘼廾弈夼奁耷奕奚奘匏尢尥尬尴扌扪抟抻拊拚拗拮挢拶挹捋捃掭揶捱捺掎掴捭掬掊捩掮掼揲揸揠揿揄揞揎摒揆掾摅摁搋搛搠搌搦搡摞撄摭撖�".split("");
	for (j = 0; j != D[222].length; ++j) if (D[222][j].charCodeAt(0) !== 65533) {
		e[D[222][j]] = 56832 + j;
		d[56832 + j] = D[222][j];
	}
	D[223] = "����������������������������������������������������������������這逜連逤逥逧逨逩逪逫逬逰週進逳逴逷逹逺逽逿遀遃遅遆遈遉遊運遌過達違遖遙遚遜遝遞遟遠遡遤遦遧適遪遫遬遯遰遱遲遳遶遷選遹遺遻遼遾邁�還邅邆邇邉邊邌邍邎邏邐邒邔邖邘邚邜邞邟邠邤邥邧邨邩邫邭邲邷邼邽邿郀摺撷撸撙撺擀擐擗擤擢攉攥攮弋忒甙弑卟叱叽叩叨叻吒吖吆呋呒呓呔呖呃吡呗呙吣吲咂咔呷呱呤咚咛咄呶呦咝哐咭哂咴哒咧咦哓哔呲咣哕咻咿哌哙哚哜咩咪咤哝哏哞唛哧唠哽唔哳唢唣唏唑唧唪啧喏喵啉啭啁啕唿啐唼�".split("");
	for (j = 0; j != D[223].length; ++j) if (D[223][j].charCodeAt(0) !== 65533) {
		e[D[223][j]] = 57088 + j;
		d[57088 + j] = D[223][j];
	}
	D[224] = "����������������������������������������������������������������郂郃郆郈郉郋郌郍郒郔郕郖郘郙郚郞郟郠郣郤郥郩郪郬郮郰郱郲郳郵郶郷郹郺郻郼郿鄀鄁鄃鄅鄆鄇鄈鄉鄊鄋鄌鄍鄎鄏鄐鄑鄒鄓鄔鄕鄖鄗鄘鄚鄛鄜�鄝鄟鄠鄡鄤鄥鄦鄧鄨鄩鄪鄫鄬鄭鄮鄰鄲鄳鄴鄵鄶鄷鄸鄺鄻鄼鄽鄾鄿酀酁酂酄唷啖啵啶啷唳唰啜喋嗒喃喱喹喈喁喟啾嗖喑啻嗟喽喾喔喙嗪嗷嗉嘟嗑嗫嗬嗔嗦嗝嗄嗯嗥嗲嗳嗌嗍嗨嗵嗤辔嘞嘈嘌嘁嘤嘣嗾嘀嘧嘭噘嘹噗嘬噍噢噙噜噌噔嚆噤噱噫噻噼嚅嚓嚯囔囗囝囡囵囫囹囿圄圊圉圜帏帙帔帑帱帻帼�".split("");
	for (j = 0; j != D[224].length; ++j) if (D[224][j].charCodeAt(0) !== 65533) {
		e[D[224][j]] = 57344 + j;
		d[57344 + j] = D[224][j];
	}
	D[225] = "����������������������������������������������������������������酅酇酈酑酓酔酕酖酘酙酛酜酟酠酦酧酨酫酭酳酺酻酼醀醁醂醃醄醆醈醊醎醏醓醔醕醖醗醘醙醜醝醞醟醠醡醤醥醦醧醨醩醫醬醰醱醲醳醶醷醸醹醻�醼醽醾醿釀釁釂釃釄釅釆釈釋釐釒釓釔釕釖釗釘釙釚釛針釞釟釠釡釢釣釤釥帷幄幔幛幞幡岌屺岍岐岖岈岘岙岑岚岜岵岢岽岬岫岱岣峁岷峄峒峤峋峥崂崃崧崦崮崤崞崆崛嵘崾崴崽嵬嵛嵯嵝嵫嵋嵊嵩嵴嶂嶙嶝豳嶷巅彳彷徂徇徉後徕徙徜徨徭徵徼衢彡犭犰犴犷犸狃狁狎狍狒狨狯狩狲狴狷猁狳猃狺�".split("");
	for (j = 0; j != D[225].length; ++j) if (D[225][j].charCodeAt(0) !== 65533) {
		e[D[225][j]] = 57600 + j;
		d[57600 + j] = D[225][j];
	}
	D[226] = "����������������������������������������������������������������釦釧釨釩釪釫釬釭釮釯釰釱釲釳釴釵釶釷釸釹釺釻釼釽釾釿鈀鈁鈂鈃鈄鈅鈆鈇鈈鈉鈊鈋鈌鈍鈎鈏鈐鈑鈒鈓鈔鈕鈖鈗鈘鈙鈚鈛鈜鈝鈞鈟鈠鈡鈢鈣鈤�鈥鈦鈧鈨鈩鈪鈫鈬鈭鈮鈯鈰鈱鈲鈳鈴鈵鈶鈷鈸鈹鈺鈻鈼鈽鈾鈿鉀鉁鉂鉃鉄鉅狻猗猓猡猊猞猝猕猢猹猥猬猸猱獐獍獗獠獬獯獾舛夥飧夤夂饣饧饨饩饪饫饬饴饷饽馀馄馇馊馍馐馑馓馔馕庀庑庋庖庥庠庹庵庾庳赓廒廑廛廨廪膺忄忉忖忏怃忮怄忡忤忾怅怆忪忭忸怙怵怦怛怏怍怩怫怊怿怡恸恹恻恺恂�".split("");
	for (j = 0; j != D[226].length; ++j) if (D[226][j].charCodeAt(0) !== 65533) {
		e[D[226][j]] = 57856 + j;
		d[57856 + j] = D[226][j];
	}
	D[227] = "����������������������������������������������������������������鉆鉇鉈鉉鉊鉋鉌鉍鉎鉏鉐鉑鉒鉓鉔鉕鉖鉗鉘鉙鉚鉛鉜鉝鉞鉟鉠鉡鉢鉣鉤鉥鉦鉧鉨鉩鉪鉫鉬鉭鉮鉯鉰鉱鉲鉳鉵鉶鉷鉸鉹鉺鉻鉼鉽鉾鉿銀銁銂銃銄銅�銆銇銈銉銊銋銌銍銏銐銑銒銓銔銕銖銗銘銙銚銛銜銝銞銟銠銡銢銣銤銥銦銧恪恽悖悚悭悝悃悒悌悛惬悻悱惝惘惆惚悴愠愦愕愣惴愀愎愫慊慵憬憔憧憷懔懵忝隳闩闫闱闳闵闶闼闾阃阄阆阈阊阋阌阍阏阒阕阖阗阙阚丬爿戕氵汔汜汊沣沅沐沔沌汨汩汴汶沆沩泐泔沭泷泸泱泗沲泠泖泺泫泮沱泓泯泾�".split("");
	for (j = 0; j != D[227].length; ++j) if (D[227][j].charCodeAt(0) !== 65533) {
		e[D[227][j]] = 58112 + j;
		d[58112 + j] = D[227][j];
	}
	D[228] = "����������������������������������������������������������������銨銩銪銫銬銭銯銰銱銲銳銴銵銶銷銸銹銺銻銼銽銾銿鋀鋁鋂鋃鋄鋅鋆鋇鋉鋊鋋鋌鋍鋎鋏鋐鋑鋒鋓鋔鋕鋖鋗鋘鋙鋚鋛鋜鋝鋞鋟鋠鋡鋢鋣鋤鋥鋦鋧鋨�鋩鋪鋫鋬鋭鋮鋯鋰鋱鋲鋳鋴鋵鋶鋷鋸鋹鋺鋻鋼鋽鋾鋿錀錁錂錃錄錅錆錇錈錉洹洧洌浃浈洇洄洙洎洫浍洮洵洚浏浒浔洳涑浯涞涠浞涓涔浜浠浼浣渚淇淅淞渎涿淠渑淦淝淙渖涫渌涮渫湮湎湫溲湟溆湓湔渲渥湄滟溱溘滠漭滢溥溧溽溻溷滗溴滏溏滂溟潢潆潇漤漕滹漯漶潋潴漪漉漩澉澍澌潸潲潼潺濑�".split("");
	for (j = 0; j != D[228].length; ++j) if (D[228][j].charCodeAt(0) !== 65533) {
		e[D[228][j]] = 58368 + j;
		d[58368 + j] = D[228][j];
	}
	D[229] = "����������������������������������������������������������������錊錋錌錍錎錏錐錑錒錓錔錕錖錗錘錙錚錛錜錝錞錟錠錡錢錣錤錥錦錧錨錩錪錫錬錭錮錯錰錱録錳錴錵錶錷錸錹錺錻錼錽錿鍀鍁鍂鍃鍄鍅鍆鍇鍈鍉�鍊鍋鍌鍍鍎鍏鍐鍑鍒鍓鍔鍕鍖鍗鍘鍙鍚鍛鍜鍝鍞鍟鍠鍡鍢鍣鍤鍥鍦鍧鍨鍩鍫濉澧澹澶濂濡濮濞濠濯瀚瀣瀛瀹瀵灏灞宀宄宕宓宥宸甯骞搴寤寮褰寰蹇謇辶迓迕迥迮迤迩迦迳迨逅逄逋逦逑逍逖逡逵逶逭逯遄遑遒遐遨遘遢遛暹遴遽邂邈邃邋彐彗彖彘尻咫屐屙孱屣屦羼弪弩弭艴弼鬻屮妁妃妍妩妪妣�".split("");
	for (j = 0; j != D[229].length; ++j) if (D[229][j].charCodeAt(0) !== 65533) {
		e[D[229][j]] = 58624 + j;
		d[58624 + j] = D[229][j];
	}
	D[230] = "����������������������������������������������������������������鍬鍭鍮鍯鍰鍱鍲鍳鍴鍵鍶鍷鍸鍹鍺鍻鍼鍽鍾鍿鎀鎁鎂鎃鎄鎅鎆鎇鎈鎉鎊鎋鎌鎍鎎鎐鎑鎒鎓鎔鎕鎖鎗鎘鎙鎚鎛鎜鎝鎞鎟鎠鎡鎢鎣鎤鎥鎦鎧鎨鎩鎪鎫�鎬鎭鎮鎯鎰鎱鎲鎳鎴鎵鎶鎷鎸鎹鎺鎻鎼鎽鎾鎿鏀鏁鏂鏃鏄鏅鏆鏇鏈鏉鏋鏌鏍妗姊妫妞妤姒妲妯姗妾娅娆姝娈姣姘姹娌娉娲娴娑娣娓婀婧婊婕娼婢婵胬媪媛婷婺媾嫫媲嫒嫔媸嫠嫣嫱嫖嫦嫘嫜嬉嬗嬖嬲嬷孀尕尜孚孥孳孑孓孢驵驷驸驺驿驽骀骁骅骈骊骐骒骓骖骘骛骜骝骟骠骢骣骥骧纟纡纣纥纨纩�".split("");
	for (j = 0; j != D[230].length; ++j) if (D[230][j].charCodeAt(0) !== 65533) {
		e[D[230][j]] = 58880 + j;
		d[58880 + j] = D[230][j];
	}
	D[231] = "����������������������������������������������������������������鏎鏏鏐鏑鏒鏓鏔鏕鏗鏘鏙鏚鏛鏜鏝鏞鏟鏠鏡鏢鏣鏤鏥鏦鏧鏨鏩鏪鏫鏬鏭鏮鏯鏰鏱鏲鏳鏴鏵鏶鏷鏸鏹鏺鏻鏼鏽鏾鏿鐀鐁鐂鐃鐄鐅鐆鐇鐈鐉鐊鐋鐌鐍�鐎鐏鐐鐑鐒鐓鐔鐕鐖鐗鐘鐙鐚鐛鐜鐝鐞鐟鐠鐡鐢鐣鐤鐥鐦鐧鐨鐩鐪鐫鐬鐭鐮纭纰纾绀绁绂绉绋绌绐绔绗绛绠绡绨绫绮绯绱绲缍绶绺绻绾缁缂缃缇缈缋缌缏缑缒缗缙缜缛缟缡缢缣缤缥缦缧缪缫缬缭缯缰缱缲缳缵幺畿巛甾邕玎玑玮玢玟珏珂珑玷玳珀珉珈珥珙顼琊珩珧珞玺珲琏琪瑛琦琥琨琰琮琬�".split("");
	for (j = 0; j != D[231].length; ++j) if (D[231][j].charCodeAt(0) !== 65533) {
		e[D[231][j]] = 59136 + j;
		d[59136 + j] = D[231][j];
	}
	D[232] = "����������������������������������������������������������������鐯鐰鐱鐲鐳鐴鐵鐶鐷鐸鐹鐺鐻鐼鐽鐿鑀鑁鑂鑃鑄鑅鑆鑇鑈鑉鑊鑋鑌鑍鑎鑏鑐鑑鑒鑓鑔鑕鑖鑗鑘鑙鑚鑛鑜鑝鑞鑟鑠鑡鑢鑣鑤鑥鑦鑧鑨鑩鑪鑬鑭鑮鑯�鑰鑱鑲鑳鑴鑵鑶鑷鑸鑹鑺鑻鑼鑽鑾鑿钀钁钂钃钄钑钖钘铇铏铓铔铚铦铻锜锠琛琚瑁瑜瑗瑕瑙瑷瑭瑾璜璎璀璁璇璋璞璨璩璐璧瓒璺韪韫韬杌杓杞杈杩枥枇杪杳枘枧杵枨枞枭枋杷杼柰栉柘栊柩枰栌柙枵柚枳柝栀柃枸柢栎柁柽栲栳桠桡桎桢桄桤梃栝桕桦桁桧桀栾桊桉栩梵梏桴桷梓桫棂楮棼椟椠棹�".split("");
	for (j = 0; j != D[232].length; ++j) if (D[232][j].charCodeAt(0) !== 65533) {
		e[D[232][j]] = 59392 + j;
		d[59392 + j] = D[232][j];
	}
	D[233] = "����������������������������������������������������������������锧锳锽镃镈镋镕镚镠镮镴镵長镸镹镺镻镼镽镾門閁閂閃閄閅閆閇閈閉閊開閌閍閎閏閐閑閒間閔閕閖閗閘閙閚閛閜閝閞閟閠閡関閣閤閥閦閧閨閩閪�閫閬閭閮閯閰閱閲閳閴閵閶閷閸閹閺閻閼閽閾閿闀闁闂闃闄闅闆闇闈闉闊闋椤棰椋椁楗棣椐楱椹楠楂楝榄楫榀榘楸椴槌榇榈槎榉楦楣楹榛榧榻榫榭槔榱槁槊槟榕槠榍槿樯槭樗樘橥槲橄樾檠橐橛樵檎橹樽樨橘橼檑檐檩檗檫猷獒殁殂殇殄殒殓殍殚殛殡殪轫轭轱轲轳轵轶轸轷轹轺轼轾辁辂辄辇辋�".split("");
	for (j = 0; j != D[233].length; ++j) if (D[233][j].charCodeAt(0) !== 65533) {
		e[D[233][j]] = 59648 + j;
		d[59648 + j] = D[233][j];
	}
	D[234] = "����������������������������������������������������������������闌闍闎闏闐闑闒闓闔闕闖闗闘闙闚闛關闝闞闟闠闡闢闣闤闥闦闧闬闿阇阓阘阛阞阠阣阤阥阦阧阨阩阫阬阭阯阰阷阸阹阺阾陁陃陊陎陏陑陒陓陖陗�陘陙陚陜陝陞陠陣陥陦陫陭陮陯陰陱陳陸陹険陻陼陽陾陿隀隁隂隃隄隇隉隊辍辎辏辘辚軎戋戗戛戟戢戡戥戤戬臧瓯瓴瓿甏甑甓攴旮旯旰昊昙杲昃昕昀炅曷昝昴昱昶昵耆晟晔晁晏晖晡晗晷暄暌暧暝暾曛曜曦曩贲贳贶贻贽赀赅赆赈赉赇赍赕赙觇觊觋觌觎觏觐觑牮犟牝牦牯牾牿犄犋犍犏犒挈挲掰�".split("");
	for (j = 0; j != D[234].length; ++j) if (D[234][j].charCodeAt(0) !== 65533) {
		e[D[234][j]] = 59904 + j;
		d[59904 + j] = D[234][j];
	}
	D[235] = "����������������������������������������������������������������隌階隑隒隓隕隖隚際隝隞隟隠隡隢隣隤隥隦隨隩險隫隬隭隮隯隱隲隴隵隷隸隺隻隿雂雃雈雊雋雐雑雓雔雖雗雘雙雚雛雜雝雞雟雡離難雤雥雦雧雫�雬雭雮雰雱雲雴雵雸雺電雼雽雿霂霃霅霊霋霌霐霑霒霔霕霗霘霙霚霛霝霟霠搿擘耄毪毳毽毵毹氅氇氆氍氕氘氙氚氡氩氤氪氲攵敕敫牍牒牖爰虢刖肟肜肓肼朊肽肱肫肭肴肷胧胨胩胪胛胂胄胙胍胗朐胝胫胱胴胭脍脎胲胼朕脒豚脶脞脬脘脲腈腌腓腴腙腚腱腠腩腼腽腭腧塍媵膈膂膑滕膣膪臌朦臊膻�".split("");
	for (j = 0; j != D[235].length; ++j) if (D[235][j].charCodeAt(0) !== 65533) {
		e[D[235][j]] = 60160 + j;
		d[60160 + j] = D[235][j];
	}
	D[236] = "����������������������������������������������������������������霡霢霣霤霥霦霧霨霩霫霬霮霯霱霳霴霵霶霷霺霻霼霽霿靀靁靂靃靄靅靆靇靈靉靊靋靌靍靎靏靐靑靔靕靗靘靚靜靝靟靣靤靦靧靨靪靫靬靭靮靯靰靱�靲靵靷靸靹靺靻靽靾靿鞀鞁鞂鞃鞄鞆鞇鞈鞉鞊鞌鞎鞏鞐鞓鞕鞖鞗鞙鞚鞛鞜鞝臁膦欤欷欹歃歆歙飑飒飓飕飙飚殳彀毂觳斐齑斓於旆旄旃旌旎旒旖炀炜炖炝炻烀炷炫炱烨烊焐焓焖焯焱煳煜煨煅煲煊煸煺熘熳熵熨熠燠燔燧燹爝爨灬焘煦熹戾戽扃扈扉礻祀祆祉祛祜祓祚祢祗祠祯祧祺禅禊禚禧禳忑忐�".split("");
	for (j = 0; j != D[236].length; ++j) if (D[236][j].charCodeAt(0) !== 65533) {
		e[D[236][j]] = 60416 + j;
		d[60416 + j] = D[236][j];
	}
	D[237] = "����������������������������������������������������������������鞞鞟鞡鞢鞤鞥鞦鞧鞨鞩鞪鞬鞮鞰鞱鞳鞵鞶鞷鞸鞹鞺鞻鞼鞽鞾鞿韀韁韂韃韄韅韆韇韈韉韊韋韌韍韎韏韐韑韒韓韔韕韖韗韘韙韚韛韜韝韞韟韠韡韢韣�韤韥韨韮韯韰韱韲韴韷韸韹韺韻韼韽韾響頀頁頂頃頄項順頇須頉頊頋頌頍頎怼恝恚恧恁恙恣悫愆愍慝憩憝懋懑戆肀聿沓泶淼矶矸砀砉砗砘砑斫砭砜砝砹砺砻砟砼砥砬砣砩硎硭硖硗砦硐硇硌硪碛碓碚碇碜碡碣碲碹碥磔磙磉磬磲礅磴礓礤礞礴龛黹黻黼盱眄眍盹眇眈眚眢眙眭眦眵眸睐睑睇睃睚睨�".split("");
	for (j = 0; j != D[237].length; ++j) if (D[237][j].charCodeAt(0) !== 65533) {
		e[D[237][j]] = 60672 + j;
		d[60672 + j] = D[237][j];
	}
	D[238] = "����������������������������������������������������������������頏預頑頒頓頔頕頖頗領頙頚頛頜頝頞頟頠頡頢頣頤頥頦頧頨頩頪頫頬頭頮頯頰頱頲頳頴頵頶頷頸頹頺頻頼頽頾頿顀顁顂顃顄顅顆顇顈顉顊顋題額�顎顏顐顑顒顓顔顕顖顗願顙顚顛顜顝類顟顠顡顢顣顤顥顦顧顨顩顪顫顬顭顮睢睥睿瞍睽瞀瞌瞑瞟瞠瞰瞵瞽町畀畎畋畈畛畲畹疃罘罡罟詈罨罴罱罹羁罾盍盥蠲钅钆钇钋钊钌钍钏钐钔钗钕钚钛钜钣钤钫钪钭钬钯钰钲钴钶钷钸钹钺钼钽钿铄铈铉铊铋铌铍铎铐铑铒铕铖铗铙铘铛铞铟铠铢铤铥铧铨铪�".split("");
	for (j = 0; j != D[238].length; ++j) if (D[238][j].charCodeAt(0) !== 65533) {
		e[D[238][j]] = 60928 + j;
		d[60928 + j] = D[238][j];
	}
	D[239] = "����������������������������������������������������������������顯顰顱顲顳顴颋颎颒颕颙颣風颩颪颫颬颭颮颯颰颱颲颳颴颵颶颷颸颹颺颻颼颽颾颿飀飁飂飃飄飅飆飇飈飉飊飋飌飍飏飐飔飖飗飛飜飝飠飡飢飣飤�飥飦飩飪飫飬飭飮飯飰飱飲飳飴飵飶飷飸飹飺飻飼飽飾飿餀餁餂餃餄餅餆餇铩铫铮铯铳铴铵铷铹铼铽铿锃锂锆锇锉锊锍锎锏锒锓锔锕锖锘锛锝锞锟锢锪锫锩锬锱锲锴锶锷锸锼锾锿镂锵镄镅镆镉镌镎镏镒镓镔镖镗镘镙镛镞镟镝镡镢镤镥镦镧镨镩镪镫镬镯镱镲镳锺矧矬雉秕秭秣秫稆嵇稃稂稞稔�".split("");
	for (j = 0; j != D[239].length; ++j) if (D[239][j].charCodeAt(0) !== 65533) {
		e[D[239][j]] = 61184 + j;
		d[61184 + j] = D[239][j];
	}
	D[240] = "����������������������������������������������������������������餈餉養餋餌餎餏餑餒餓餔餕餖餗餘餙餚餛餜餝餞餟餠餡餢餣餤餥餦餧館餩餪餫餬餭餯餰餱餲餳餴餵餶餷餸餹餺餻餼餽餾餿饀饁饂饃饄饅饆饇饈饉�饊饋饌饍饎饏饐饑饒饓饖饗饘饙饚饛饜饝饞饟饠饡饢饤饦饳饸饹饻饾馂馃馉稹稷穑黏馥穰皈皎皓皙皤瓞瓠甬鸠鸢鸨鸩鸪鸫鸬鸲鸱鸶鸸鸷鸹鸺鸾鹁鹂鹄鹆鹇鹈鹉鹋鹌鹎鹑鹕鹗鹚鹛鹜鹞鹣鹦鹧鹨鹩鹪鹫鹬鹱鹭鹳疒疔疖疠疝疬疣疳疴疸痄疱疰痃痂痖痍痣痨痦痤痫痧瘃痱痼痿瘐瘀瘅瘌瘗瘊瘥瘘瘕瘙�".split("");
	for (j = 0; j != D[240].length; ++j) if (D[240][j].charCodeAt(0) !== 65533) {
		e[D[240][j]] = 61440 + j;
		d[61440 + j] = D[240][j];
	}
	D[241] = "����������������������������������������������������������������馌馎馚馛馜馝馞馟馠馡馢馣馤馦馧馩馪馫馬馭馮馯馰馱馲馳馴馵馶馷馸馹馺馻馼馽馾馿駀駁駂駃駄駅駆駇駈駉駊駋駌駍駎駏駐駑駒駓駔駕駖駗駘�駙駚駛駜駝駞駟駠駡駢駣駤駥駦駧駨駩駪駫駬駭駮駯駰駱駲駳駴駵駶駷駸駹瘛瘼瘢瘠癀瘭瘰瘿瘵癃瘾瘳癍癞癔癜癖癫癯翊竦穸穹窀窆窈窕窦窠窬窨窭窳衤衩衲衽衿袂袢裆袷袼裉裢裎裣裥裱褚裼裨裾裰褡褙褓褛褊褴褫褶襁襦襻疋胥皲皴矜耒耔耖耜耠耢耥耦耧耩耨耱耋耵聃聆聍聒聩聱覃顸颀颃�".split("");
	for (j = 0; j != D[241].length; ++j) if (D[241][j].charCodeAt(0) !== 65533) {
		e[D[241][j]] = 61696 + j;
		d[61696 + j] = D[241][j];
	}
	D[242] = "����������������������������������������������������������������駺駻駼駽駾駿騀騁騂騃騄騅騆騇騈騉騊騋騌騍騎騏騐騑騒験騔騕騖騗騘騙騚騛騜騝騞騟騠騡騢騣騤騥騦騧騨騩騪騫騬騭騮騯騰騱騲騳騴騵騶騷騸�騹騺騻騼騽騾騿驀驁驂驃驄驅驆驇驈驉驊驋驌驍驎驏驐驑驒驓驔驕驖驗驘驙颉颌颍颏颔颚颛颞颟颡颢颥颦虍虔虬虮虿虺虼虻蚨蚍蚋蚬蚝蚧蚣蚪蚓蚩蚶蛄蚵蛎蚰蚺蚱蚯蛉蛏蚴蛩蛱蛲蛭蛳蛐蜓蛞蛴蛟蛘蛑蜃蜇蛸蜈蜊蜍蜉蜣蜻蜞蜥蜮蜚蜾蝈蜴蜱蜩蜷蜿螂蜢蝽蝾蝻蝠蝰蝌蝮螋蝓蝣蝼蝤蝙蝥螓螯螨蟒�".split("");
	for (j = 0; j != D[242].length; ++j) if (D[242][j].charCodeAt(0) !== 65533) {
		e[D[242][j]] = 61952 + j;
		d[61952 + j] = D[242][j];
	}
	D[243] = "����������������������������������������������������������������驚驛驜驝驞驟驠驡驢驣驤驥驦驧驨驩驪驫驲骃骉骍骎骔骕骙骦骩骪骫骬骭骮骯骲骳骴骵骹骻骽骾骿髃髄髆髇髈髉髊髍髎髏髐髒體髕髖髗髙髚髛髜�髝髞髠髢髣髤髥髧髨髩髪髬髮髰髱髲髳髴髵髶髷髸髺髼髽髾髿鬀鬁鬂鬄鬅鬆蟆螈螅螭螗螃螫蟥螬螵螳蟋蟓螽蟑蟀蟊蟛蟪蟠蟮蠖蠓蟾蠊蠛蠡蠹蠼缶罂罄罅舐竺竽笈笃笄笕笊笫笏筇笸笪笙笮笱笠笥笤笳笾笞筘筚筅筵筌筝筠筮筻筢筲筱箐箦箧箸箬箝箨箅箪箜箢箫箴篑篁篌篝篚篥篦篪簌篾篼簏簖簋�".split("");
	for (j = 0; j != D[243].length; ++j) if (D[243][j].charCodeAt(0) !== 65533) {
		e[D[243][j]] = 62208 + j;
		d[62208 + j] = D[243][j];
	}
	D[244] = "����������������������������������������������������������������鬇鬉鬊鬋鬌鬍鬎鬐鬑鬒鬔鬕鬖鬗鬘鬙鬚鬛鬜鬝鬞鬠鬡鬢鬤鬥鬦鬧鬨鬩鬪鬫鬬鬭鬮鬰鬱鬳鬴鬵鬶鬷鬸鬹鬺鬽鬾鬿魀魆魊魋魌魎魐魒魓魕魖魗魘魙魚�魛魜魝魞魟魠魡魢魣魤魥魦魧魨魩魪魫魬魭魮魯魰魱魲魳魴魵魶魷魸魹魺魻簟簪簦簸籁籀臾舁舂舄臬衄舡舢舣舭舯舨舫舸舻舳舴舾艄艉艋艏艚艟艨衾袅袈裘裟襞羝羟羧羯羰羲籼敉粑粝粜粞粢粲粼粽糁糇糌糍糈糅糗糨艮暨羿翎翕翥翡翦翩翮翳糸絷綦綮繇纛麸麴赳趄趔趑趱赧赭豇豉酊酐酎酏酤�".split("");
	for (j = 0; j != D[244].length; ++j) if (D[244][j].charCodeAt(0) !== 65533) {
		e[D[244][j]] = 62464 + j;
		d[62464 + j] = D[244][j];
	}
	D[245] = "����������������������������������������������������������������魼魽魾魿鮀鮁鮂鮃鮄鮅鮆鮇鮈鮉鮊鮋鮌鮍鮎鮏鮐鮑鮒鮓鮔鮕鮖鮗鮘鮙鮚鮛鮜鮝鮞鮟鮠鮡鮢鮣鮤鮥鮦鮧鮨鮩鮪鮫鮬鮭鮮鮯鮰鮱鮲鮳鮴鮵鮶鮷鮸鮹鮺�鮻鮼鮽鮾鮿鯀鯁鯂鯃鯄鯅鯆鯇鯈鯉鯊鯋鯌鯍鯎鯏鯐鯑鯒鯓鯔鯕鯖鯗鯘鯙鯚鯛酢酡酰酩酯酽酾酲酴酹醌醅醐醍醑醢醣醪醭醮醯醵醴醺豕鹾趸跫踅蹙蹩趵趿趼趺跄跖跗跚跞跎跏跛跆跬跷跸跣跹跻跤踉跽踔踝踟踬踮踣踯踺蹀踹踵踽踱蹉蹁蹂蹑蹒蹊蹰蹶蹼蹯蹴躅躏躔躐躜躞豸貂貊貅貘貔斛觖觞觚觜�".split("");
	for (j = 0; j != D[245].length; ++j) if (D[245][j].charCodeAt(0) !== 65533) {
		e[D[245][j]] = 62720 + j;
		d[62720 + j] = D[245][j];
	}
	D[246] = "����������������������������������������������������������������鯜鯝鯞鯟鯠鯡鯢鯣鯤鯥鯦鯧鯨鯩鯪鯫鯬鯭鯮鯯鯰鯱鯲鯳鯴鯵鯶鯷鯸鯹鯺鯻鯼鯽鯾鯿鰀鰁鰂鰃鰄鰅鰆鰇鰈鰉鰊鰋鰌鰍鰎鰏鰐鰑鰒鰓鰔鰕鰖鰗鰘鰙鰚�鰛鰜鰝鰞鰟鰠鰡鰢鰣鰤鰥鰦鰧鰨鰩鰪鰫鰬鰭鰮鰯鰰鰱鰲鰳鰴鰵鰶鰷鰸鰹鰺鰻觥觫觯訾謦靓雩雳雯霆霁霈霏霎霪霭霰霾龀龃龅龆龇龈龉龊龌黾鼋鼍隹隼隽雎雒瞿雠銎銮鋈錾鍪鏊鎏鐾鑫鱿鲂鲅鲆鲇鲈稣鲋鲎鲐鲑鲒鲔鲕鲚鲛鲞鲟鲠鲡鲢鲣鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲴鲵鲶鲷鲺鲻鲼鲽鳄鳅鳆鳇鳊鳋�".split("");
	for (j = 0; j != D[246].length; ++j) if (D[246][j].charCodeAt(0) !== 65533) {
		e[D[246][j]] = 62976 + j;
		d[62976 + j] = D[246][j];
	}
	D[247] = "����������������������������������������������������������������鰼鰽鰾鰿鱀鱁鱂鱃鱄鱅鱆鱇鱈鱉鱊鱋鱌鱍鱎鱏鱐鱑鱒鱓鱔鱕鱖鱗鱘鱙鱚鱛鱜鱝鱞鱟鱠鱡鱢鱣鱤鱥鱦鱧鱨鱩鱪鱫鱬鱭鱮鱯鱰鱱鱲鱳鱴鱵鱶鱷鱸鱹鱺�鱻鱽鱾鲀鲃鲄鲉鲊鲌鲏鲓鲖鲗鲘鲙鲝鲪鲬鲯鲹鲾鲿鳀鳁鳂鳈鳉鳑鳒鳚鳛鳠鳡鳌鳍鳎鳏鳐鳓鳔鳕鳗鳘鳙鳜鳝鳟鳢靼鞅鞑鞒鞔鞯鞫鞣鞲鞴骱骰骷鹘骶骺骼髁髀髅髂髋髌髑魅魃魇魉魈魍魑飨餍餮饕饔髟髡髦髯髫髻髭髹鬈鬏鬓鬟鬣麽麾縻麂麇麈麋麒鏖麝麟黛黜黝黠黟黢黩黧黥黪黯鼢鼬鼯鼹鼷鼽鼾齄�".split("");
	for (j = 0; j != D[247].length; ++j) if (D[247][j].charCodeAt(0) !== 65533) {
		e[D[247][j]] = 63232 + j;
		d[63232 + j] = D[247][j];
	}
	D[248] = "����������������������������������������������������������������鳣鳤鳥鳦鳧鳨鳩鳪鳫鳬鳭鳮鳯鳰鳱鳲鳳鳴鳵鳶鳷鳸鳹鳺鳻鳼鳽鳾鳿鴀鴁鴂鴃鴄鴅鴆鴇鴈鴉鴊鴋鴌鴍鴎鴏鴐鴑鴒鴓鴔鴕鴖鴗鴘鴙鴚鴛鴜鴝鴞鴟鴠鴡�鴢鴣鴤鴥鴦鴧鴨鴩鴪鴫鴬鴭鴮鴯鴰鴱鴲鴳鴴鴵鴶鴷鴸鴹鴺鴻鴼鴽鴾鴿鵀鵁鵂�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[248].length; ++j) if (D[248][j].charCodeAt(0) !== 65533) {
		e[D[248][j]] = 63488 + j;
		d[63488 + j] = D[248][j];
	}
	D[249] = "����������������������������������������������������������������鵃鵄鵅鵆鵇鵈鵉鵊鵋鵌鵍鵎鵏鵐鵑鵒鵓鵔鵕鵖鵗鵘鵙鵚鵛鵜鵝鵞鵟鵠鵡鵢鵣鵤鵥鵦鵧鵨鵩鵪鵫鵬鵭鵮鵯鵰鵱鵲鵳鵴鵵鵶鵷鵸鵹鵺鵻鵼鵽鵾鵿鶀鶁�鶂鶃鶄鶅鶆鶇鶈鶉鶊鶋鶌鶍鶎鶏鶐鶑鶒鶓鶔鶕鶖鶗鶘鶙鶚鶛鶜鶝鶞鶟鶠鶡鶢�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[249].length; ++j) if (D[249][j].charCodeAt(0) !== 65533) {
		e[D[249][j]] = 63744 + j;
		d[63744 + j] = D[249][j];
	}
	D[250] = "����������������������������������������������������������������鶣鶤鶥鶦鶧鶨鶩鶪鶫鶬鶭鶮鶯鶰鶱鶲鶳鶴鶵鶶鶷鶸鶹鶺鶻鶼鶽鶾鶿鷀鷁鷂鷃鷄鷅鷆鷇鷈鷉鷊鷋鷌鷍鷎鷏鷐鷑鷒鷓鷔鷕鷖鷗鷘鷙鷚鷛鷜鷝鷞鷟鷠鷡�鷢鷣鷤鷥鷦鷧鷨鷩鷪鷫鷬鷭鷮鷯鷰鷱鷲鷳鷴鷵鷶鷷鷸鷹鷺鷻鷼鷽鷾鷿鸀鸁鸂�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[250].length; ++j) if (D[250][j].charCodeAt(0) !== 65533) {
		e[D[250][j]] = 64e3 + j;
		d[64e3 + j] = D[250][j];
	}
	D[251] = "����������������������������������������������������������������鸃鸄鸅鸆鸇鸈鸉鸊鸋鸌鸍鸎鸏鸐鸑鸒鸓鸔鸕鸖鸗鸘鸙鸚鸛鸜鸝鸞鸤鸧鸮鸰鸴鸻鸼鹀鹍鹐鹒鹓鹔鹖鹙鹝鹟鹠鹡鹢鹥鹮鹯鹲鹴鹵鹶鹷鹸鹹鹺鹻鹼鹽麀�麁麃麄麅麆麉麊麌麍麎麏麐麑麔麕麖麗麘麙麚麛麜麞麠麡麢麣麤麥麧麨麩麪�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[251].length; ++j) if (D[251][j].charCodeAt(0) !== 65533) {
		e[D[251][j]] = 64256 + j;
		d[64256 + j] = D[251][j];
	}
	D[252] = "����������������������������������������������������������������麫麬麭麮麯麰麱麲麳麵麶麷麹麺麼麿黀黁黂黃黅黆黇黈黊黋黌黐黒黓黕黖黗黙黚點黡黣黤黦黨黫黬黭黮黰黱黲黳黴黵黶黷黸黺黽黿鼀鼁鼂鼃鼄鼅�鼆鼇鼈鼉鼊鼌鼏鼑鼒鼔鼕鼖鼘鼚鼛鼜鼝鼞鼟鼡鼣鼤鼥鼦鼧鼨鼩鼪鼫鼭鼮鼰鼱�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[252].length; ++j) if (D[252][j].charCodeAt(0) !== 65533) {
		e[D[252][j]] = 64512 + j;
		d[64512 + j] = D[252][j];
	}
	D[253] = "����������������������������������������������������������������鼲鼳鼴鼵鼶鼸鼺鼼鼿齀齁齂齃齅齆齇齈齉齊齋齌齍齎齏齒齓齔齕齖齗齘齙齚齛齜齝齞齟齠齡齢齣齤齥齦齧齨齩齪齫齬齭齮齯齰齱齲齳齴齵齶齷齸�齹齺齻齼齽齾龁龂龍龎龏龐龑龒龓龔龕龖龗龘龜龝龞龡龢龣龤龥郎凉秊裏隣�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[253].length; ++j) if (D[253][j].charCodeAt(0) !== 65533) {
		e[D[253][j]] = 64768 + j;
		d[64768 + j] = D[253][j];
	}
	D[254] = "����������������������������������������������������������������兀嗀﨎﨏﨑﨓﨔礼﨟蘒﨡﨣﨤﨧﨨﨩��������������������������������������������������������������������������������������������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[254].length; ++j) if (D[254][j].charCodeAt(0) !== 65533) {
		e[D[254][j]] = 65024 + j;
		d[65024 + j] = D[254][j];
	}
	return {
		"enc": e,
		"dec": d
	};
})();
cptable[949] = (function() {
	var d = [], e = {}, D = [], j;
	D[0] = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~��������������������������������������������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[0].length; ++j) if (D[0][j].charCodeAt(0) !== 65533) {
		e[D[0][j]] = 0 + j;
		d[0 + j] = D[0][j];
	}
	D[129] = "�����������������������������������������������������������������갂갃갅갆갋갌갍갎갏갘갞갟갡갢갣갥갦갧갨갩갪갫갮갲갳갴������갵갶갷갺갻갽갾갿걁걂걃걄걅걆걇걈걉걊걌걎걏걐걑걒걓걕������걖걗걙걚걛걝걞걟걠걡걢걣걤걥걦걧걨걩걪걫걬걭걮걯걲걳걵걶걹걻걼걽걾걿겂겇겈겍겎겏겑겒겓겕겖겗겘겙겚겛겞겢겣겤겥겦겧겫겭겮겱겲겳겴겵겶겷겺겾겿곀곂곃곅곆곇곉곊곋곍곎곏곐곑곒곓곔곖곘곙곚곛곜곝곞곟곢곣곥곦곩곫곭곮곲곴곷곸곹곺곻곾곿괁괂괃괅괇괈괉괊괋괎괐괒괓�".split("");
	for (j = 0; j != D[129].length; ++j) if (D[129][j].charCodeAt(0) !== 65533) {
		e[D[129][j]] = 33024 + j;
		d[33024 + j] = D[129][j];
	}
	D[130] = "�����������������������������������������������������������������괔괕괖괗괙괚괛괝괞괟괡괢괣괤괥괦괧괨괪괫괮괯괰괱괲괳������괶괷괹괺괻괽괾괿굀굁굂굃굆굈굊굋굌굍굎굏굑굒굓굕굖굗������굙굚굛굜굝굞굟굠굢굤굥굦굧굨굩굪굫굮굯굱굲굷굸굹굺굾궀궃궄궅궆궇궊궋궍궎궏궑궒궓궔궕궖궗궘궙궚궛궞궟궠궡궢궣궥궦궧궨궩궪궫궬궭궮궯궰궱궲궳궴궵궶궸궹궺궻궼궽궾궿귂귃귅귆귇귉귊귋귌귍귎귏귒귔귕귖귗귘귙귚귛귝귞귟귡귢귣귥귦귧귨귩귪귫귬귭귮귯귰귱귲귳귴귵귶귷�".split("");
	for (j = 0; j != D[130].length; ++j) if (D[130][j].charCodeAt(0) !== 65533) {
		e[D[130][j]] = 33280 + j;
		d[33280 + j] = D[130][j];
	}
	D[131] = "�����������������������������������������������������������������귺귻귽귾긂긃긄긅긆긇긊긌긎긏긐긑긒긓긕긖긗긘긙긚긛긜������긝긞긟긠긡긢긣긤긥긦긧긨긩긪긫긬긭긮긯긲긳긵긶긹긻긼������긽긾긿깂깄깇깈깉깋깏깑깒깓깕깗깘깙깚깛깞깢깣깤깦깧깪깫깭깮깯깱깲깳깴깵깶깷깺깾깿꺀꺁꺂꺃꺆꺇꺈꺉꺊꺋꺍꺎꺏꺐꺑꺒꺓꺔꺕꺖꺗꺘꺙꺚꺛꺜꺝꺞꺟꺠꺡꺢꺣꺤꺥꺦꺧꺨꺩꺪꺫꺬꺭꺮꺯꺰꺱꺲꺳꺴꺵꺶꺷꺸꺹꺺꺻꺿껁껂껃껅껆껇껈껉껊껋껎껒껓껔껕껖껗껚껛껝껞껟껠껡껢껣껤껥�".split("");
	for (j = 0; j != D[131].length; ++j) if (D[131][j].charCodeAt(0) !== 65533) {
		e[D[131][j]] = 33536 + j;
		d[33536 + j] = D[131][j];
	}
	D[132] = "�����������������������������������������������������������������껦껧껩껪껬껮껯껰껱껲껳껵껶껷껹껺껻껽껾껿꼀꼁꼂꼃꼄꼅������꼆꼉꼊꼋꼌꼎꼏꼑꼒꼓꼔꼕꼖꼗꼘꼙꼚꼛꼜꼝꼞꼟꼠꼡꼢꼣������꼤꼥꼦꼧꼨꼩꼪꼫꼮꼯꼱꼳꼵꼶꼷꼸꼹꼺꼻꼾꽀꽄꽅꽆꽇꽊꽋꽌꽍꽎꽏꽑꽒꽓꽔꽕꽖꽗꽘꽙꽚꽛꽞꽟꽠꽡꽢꽣꽦꽧꽨꽩꽪꽫꽬꽭꽮꽯꽰꽱꽲꽳꽴꽵꽶꽷꽸꽺꽻꽼꽽꽾꽿꾁꾂꾃꾅꾆꾇꾉꾊꾋꾌꾍꾎꾏꾒꾓꾔꾖꾗꾘꾙꾚꾛꾝꾞꾟꾠꾡꾢꾣꾤꾥꾦꾧꾨꾩꾪꾫꾬꾭꾮꾯꾰꾱꾲꾳꾴꾵꾶꾷꾺꾻꾽꾾�".split("");
	for (j = 0; j != D[132].length; ++j) if (D[132][j].charCodeAt(0) !== 65533) {
		e[D[132][j]] = 33792 + j;
		d[33792 + j] = D[132][j];
	}
	D[133] = "�����������������������������������������������������������������꾿꿁꿂꿃꿄꿅꿆꿊꿌꿏꿐꿑꿒꿓꿕꿖꿗꿘꿙꿚꿛꿝꿞꿟꿠꿡������꿢꿣꿤꿥꿦꿧꿪꿫꿬꿭꿮꿯꿲꿳꿵꿶꿷꿹꿺꿻꿼꿽꿾꿿뀂뀃������뀅뀆뀇뀈뀉뀊뀋뀍뀎뀏뀑뀒뀓뀕뀖뀗뀘뀙뀚뀛뀞뀟뀠뀡뀢뀣뀤뀥뀦뀧뀩뀪뀫뀬뀭뀮뀯뀰뀱뀲뀳뀴뀵뀶뀷뀸뀹뀺뀻뀼뀽뀾뀿끀끁끂끃끆끇끉끋끍끏끐끑끒끖끘끚끛끜끞끟끠끡끢끣끤끥끦끧끨끩끪끫끬끭끮끯끰끱끲끳끴끵끶끷끸끹끺끻끾끿낁낂낃낅낆낇낈낉낊낋낎낐낒낓낔낕낖낗낛낝낞낣낤�".split("");
	for (j = 0; j != D[133].length; ++j) if (D[133][j].charCodeAt(0) !== 65533) {
		e[D[133][j]] = 34048 + j;
		d[34048 + j] = D[133][j];
	}
	D[134] = "�����������������������������������������������������������������낥낦낧낪낰낲낶낷낹낺낻낽낾낿냀냁냂냃냆냊냋냌냍냎냏냒������냓냕냖냗냙냚냛냜냝냞냟냡냢냣냤냦냧냨냩냪냫냬냭냮냯냰������냱냲냳냴냵냶냷냸냹냺냻냼냽냾냿넀넁넂넃넄넅넆넇넊넍넎넏넑넔넕넖넗넚넞넟넠넡넢넦넧넩넪넫넭넮넯넰넱넲넳넶넺넻넼넽넾넿녂녃녅녆녇녉녊녋녌녍녎녏녒녓녖녗녙녚녛녝녞녟녡녢녣녤녥녦녧녨녩녪녫녬녭녮녯녰녱녲녳녴녵녶녷녺녻녽녾녿놁놃놄놅놆놇놊놌놎놏놐놑놕놖놗놙놚놛놝�".split("");
	for (j = 0; j != D[134].length; ++j) if (D[134][j].charCodeAt(0) !== 65533) {
		e[D[134][j]] = 34304 + j;
		d[34304 + j] = D[134][j];
	}
	D[135] = "�����������������������������������������������������������������놞놟놠놡놢놣놤놥놦놧놩놪놫놬놭놮놯놰놱놲놳놴놵놶놷놸������놹놺놻놼놽놾놿뇀뇁뇂뇃뇄뇅뇆뇇뇈뇉뇊뇋뇍뇎뇏뇑뇒뇓뇕������뇖뇗뇘뇙뇚뇛뇞뇠뇡뇢뇣뇤뇥뇦뇧뇪뇫뇭뇮뇯뇱뇲뇳뇴뇵뇶뇷뇸뇺뇼뇾뇿눀눁눂눃눆눇눉눊눍눎눏눐눑눒눓눖눘눚눛눜눝눞눟눡눢눣눤눥눦눧눨눩눪눫눬눭눮눯눰눱눲눳눵눶눷눸눹눺눻눽눾눿뉀뉁뉂뉃뉄뉅뉆뉇뉈뉉뉊뉋뉌뉍뉎뉏뉐뉑뉒뉓뉔뉕뉖뉗뉙뉚뉛뉝뉞뉟뉡뉢뉣뉤뉥뉦뉧뉪뉫뉬뉭뉮�".split("");
	for (j = 0; j != D[135].length; ++j) if (D[135][j].charCodeAt(0) !== 65533) {
		e[D[135][j]] = 34560 + j;
		d[34560 + j] = D[135][j];
	}
	D[136] = "�����������������������������������������������������������������뉯뉰뉱뉲뉳뉶뉷뉸뉹뉺뉻뉽뉾뉿늀늁늂늃늆늇늈늊늋늌늍늎������늏늒늓늕늖늗늛늜늝늞늟늢늤늧늨늩늫늭늮늯늱늲늳늵늶늷������늸늹늺늻늼늽늾늿닀닁닂닃닄닅닆닇닊닋닍닎닏닑닓닔닕닖닗닚닜닞닟닠닡닣닧닩닪닰닱닲닶닼닽닾댂댃댅댆댇댉댊댋댌댍댎댏댒댖댗댘댙댚댛댝댞댟댠댡댢댣댤댥댦댧댨댩댪댫댬댭댮댯댰댱댲댳댴댵댶댷댸댹댺댻댼댽댾댿덀덁덂덃덄덅덆덇덈덉덊덋덌덍덎덏덐덑덒덓덗덙덚덝덠덡덢덣�".split("");
	for (j = 0; j != D[136].length; ++j) if (D[136][j].charCodeAt(0) !== 65533) {
		e[D[136][j]] = 34816 + j;
		d[34816 + j] = D[136][j];
	}
	D[137] = "�����������������������������������������������������������������덦덨덪덬덭덯덲덳덵덶덷덹덺덻덼덽덾덿뎂뎆뎇뎈뎉뎊뎋뎍������뎎뎏뎑뎒뎓뎕뎖뎗뎘뎙뎚뎛뎜뎝뎞뎟뎢뎣뎤뎥뎦뎧뎩뎪뎫뎭������뎮뎯뎰뎱뎲뎳뎴뎵뎶뎷뎸뎹뎺뎻뎼뎽뎾뎿돀돁돂돃돆돇돉돊돍돏돑돒돓돖돘돚돜돞돟돡돢돣돥돦돧돩돪돫돬돭돮돯돰돱돲돳돴돵돶돷돸돹돺돻돽돾돿됀됁됂됃됄됅됆됇됈됉됊됋됌됍됎됏됑됒됓됔됕됖됗됙됚됛됝됞됟됡됢됣됤됥됦됧됪됬됭됮됯됰됱됲됳됵됶됷됸됹됺됻됼됽됾됿둀둁둂둃둄�".split("");
	for (j = 0; j != D[137].length; ++j) if (D[137][j].charCodeAt(0) !== 65533) {
		e[D[137][j]] = 35072 + j;
		d[35072 + j] = D[137][j];
	}
	D[138] = "�����������������������������������������������������������������둅둆둇둈둉둊둋둌둍둎둏둒둓둕둖둗둙둚둛둜둝둞둟둢둤둦������둧둨둩둪둫둭둮둯둰둱둲둳둴둵둶둷둸둹둺둻둼둽둾둿뒁뒂������뒃뒄뒅뒆뒇뒉뒊뒋뒌뒍뒎뒏뒐뒑뒒뒓뒔뒕뒖뒗뒘뒙뒚뒛뒜뒞뒟뒠뒡뒢뒣뒥뒦뒧뒩뒪뒫뒭뒮뒯뒰뒱뒲뒳뒴뒶뒸뒺뒻뒼뒽뒾뒿듁듂듃듅듆듇듉듊듋듌듍듎듏듑듒듓듔듖듗듘듙듚듛듞듟듡듢듥듧듨듩듪듫듮듰듲듳듴듵듶듷듹듺듻듼듽듾듿딀딁딂딃딄딅딆딇딈딉딊딋딌딍딎딏딐딑딒딓딖딗딙딚딝�".split("");
	for (j = 0; j != D[138].length; ++j) if (D[138][j].charCodeAt(0) !== 65533) {
		e[D[138][j]] = 35328 + j;
		d[35328 + j] = D[138][j];
	}
	D[139] = "�����������������������������������������������������������������딞딟딠딡딢딣딦딫딬딭딮딯딲딳딵딶딷딹딺딻딼딽딾딿땂땆������땇땈땉땊땎땏땑땒땓땕땖땗땘땙땚땛땞땢땣땤땥땦땧땨땩땪������땫땬땭땮땯땰땱땲땳땴땵땶땷땸땹땺땻땼땽땾땿떀떁떂떃떄떅떆떇떈떉떊떋떌떍떎떏떐떑떒떓떔떕떖떗떘떙떚떛떜떝떞떟떢떣떥떦떧떩떬떭떮떯떲떶떷떸떹떺떾떿뗁뗂뗃뗅뗆뗇뗈뗉뗊뗋뗎뗒뗓뗔뗕뗖뗗뗙뗚뗛뗜뗝뗞뗟뗠뗡뗢뗣뗤뗥뗦뗧뗨뗩뗪뗫뗭뗮뗯뗰뗱뗲뗳뗴뗵뗶뗷뗸뗹뗺뗻뗼뗽뗾뗿�".split("");
	for (j = 0; j != D[139].length; ++j) if (D[139][j].charCodeAt(0) !== 65533) {
		e[D[139][j]] = 35584 + j;
		d[35584 + j] = D[139][j];
	}
	D[140] = "�����������������������������������������������������������������똀똁똂똃똄똅똆똇똈똉똊똋똌똍똎똏똒똓똕똖똗똙똚똛똜똝������똞똟똠똡똢똣똤똦똧똨똩똪똫똭똮똯똰똱똲똳똵똶똷똸똹똺������똻똼똽똾똿뙀뙁뙂뙃뙄뙅뙆뙇뙉뙊뙋뙌뙍뙎뙏뙐뙑뙒뙓뙔뙕뙖뙗뙘뙙뙚뙛뙜뙝뙞뙟뙠뙡뙢뙣뙥뙦뙧뙩뙪뙫뙬뙭뙮뙯뙰뙱뙲뙳뙴뙵뙶뙷뙸뙹뙺뙻뙼뙽뙾뙿뚀뚁뚂뚃뚄뚅뚆뚇뚈뚉뚊뚋뚌뚍뚎뚏뚐뚑뚒뚓뚔뚕뚖뚗뚘뚙뚚뚛뚞뚟뚡뚢뚣뚥뚦뚧뚨뚩뚪뚭뚮뚯뚰뚲뚳뚴뚵뚶뚷뚸뚹뚺뚻뚼뚽뚾뚿뛀뛁뛂�".split("");
	for (j = 0; j != D[140].length; ++j) if (D[140][j].charCodeAt(0) !== 65533) {
		e[D[140][j]] = 35840 + j;
		d[35840 + j] = D[140][j];
	}
	D[141] = "�����������������������������������������������������������������뛃뛄뛅뛆뛇뛈뛉뛊뛋뛌뛍뛎뛏뛐뛑뛒뛓뛕뛖뛗뛘뛙뛚뛛뛜뛝������뛞뛟뛠뛡뛢뛣뛤뛥뛦뛧뛨뛩뛪뛫뛬뛭뛮뛯뛱뛲뛳뛵뛶뛷뛹뛺������뛻뛼뛽뛾뛿뜂뜃뜄뜆뜇뜈뜉뜊뜋뜌뜍뜎뜏뜐뜑뜒뜓뜔뜕뜖뜗뜘뜙뜚뜛뜜뜝뜞뜟뜠뜡뜢뜣뜤뜥뜦뜧뜪뜫뜭뜮뜱뜲뜳뜴뜵뜶뜷뜺뜼뜽뜾뜿띀띁띂띃띅띆띇띉띊띋띍띎띏띐띑띒띓띖띗띘띙띚띛띜띝띞띟띡띢띣띥띦띧띩띪띫띬띭띮띯띲띴띶띷띸띹띺띻띾띿랁랂랃랅랆랇랈랉랊랋랎랓랔랕랚랛랝랞�".split("");
	for (j = 0; j != D[141].length; ++j) if (D[141][j].charCodeAt(0) !== 65533) {
		e[D[141][j]] = 36096 + j;
		d[36096 + j] = D[141][j];
	}
	D[142] = "�����������������������������������������������������������������랟랡랢랣랤랥랦랧랪랮랯랰랱랲랳랶랷랹랺랻랼랽랾랿럀럁������럂럃럄럅럆럈럊럋럌럍럎럏럐럑럒럓럔럕럖럗럘럙럚럛럜럝������럞럟럠럡럢럣럤럥럦럧럨럩럪럫럮럯럱럲럳럵럶럷럸럹럺럻럾렂렃렄렅렆렊렋렍렎렏렑렒렓렔렕렖렗렚렜렞렟렠렡렢렣렦렧렩렪렫렭렮렯렰렱렲렳렶렺렻렼렽렾렿롁롂롃롅롆롇롈롉롊롋롌롍롎롏롐롒롔롕롖롗롘롙롚롛롞롟롡롢롣롥롦롧롨롩롪롫롮롰롲롳롴롵롶롷롹롺롻롽롾롿뢀뢁뢂뢃뢄�".split("");
	for (j = 0; j != D[142].length; ++j) if (D[142][j].charCodeAt(0) !== 65533) {
		e[D[142][j]] = 36352 + j;
		d[36352 + j] = D[142][j];
	}
	D[143] = "�����������������������������������������������������������������뢅뢆뢇뢈뢉뢊뢋뢌뢎뢏뢐뢑뢒뢓뢔뢕뢖뢗뢘뢙뢚뢛뢜뢝뢞뢟������뢠뢡뢢뢣뢤뢥뢦뢧뢩뢪뢫뢬뢭뢮뢯뢱뢲뢳뢵뢶뢷뢹뢺뢻뢼뢽������뢾뢿룂룄룆룇룈룉룊룋룍룎룏룑룒룓룕룖룗룘룙룚룛룜룞룠룢룣룤룥룦룧룪룫룭룮룯룱룲룳룴룵룶룷룺룼룾룿뤀뤁뤂뤃뤅뤆뤇뤈뤉뤊뤋뤌뤍뤎뤏뤐뤑뤒뤓뤔뤕뤖뤗뤙뤚뤛뤜뤝뤞뤟뤡뤢뤣뤤뤥뤦뤧뤨뤩뤪뤫뤬뤭뤮뤯뤰뤱뤲뤳뤴뤵뤶뤷뤸뤹뤺뤻뤾뤿륁륂륃륅륆륇륈륉륊륋륍륎륐륒륓륔륕륖륗�".split("");
	for (j = 0; j != D[143].length; ++j) if (D[143][j].charCodeAt(0) !== 65533) {
		e[D[143][j]] = 36608 + j;
		d[36608 + j] = D[143][j];
	}
	D[144] = "�����������������������������������������������������������������륚륛륝륞륟륡륢륣륤륥륦륧륪륬륮륯륰륱륲륳륶륷륹륺륻륽������륾륿릀릁릂릃릆릈릋릌릏릐릑릒릓릔릕릖릗릘릙릚릛릜릝릞������릟릠릡릢릣릤릥릦릧릨릩릪릫릮릯릱릲릳릵릶릷릸릹릺릻릾맀맂맃맄맅맆맇맊맋맍맓맔맕맖맗맚맜맟맠맢맦맧맩맪맫맭맮맯맰맱맲맳맶맻맼맽맾맿먂먃먄먅먆먇먉먊먋먌먍먎먏먐먑먒먓먔먖먗먘먙먚먛먜먝먞먟먠먡먢먣먤먥먦먧먨먩먪먫먬먭먮먯먰먱먲먳먴먵먶먷먺먻먽먾먿멁멃멄멅멆�".split("");
	for (j = 0; j != D[144].length; ++j) if (D[144][j].charCodeAt(0) !== 65533) {
		e[D[144][j]] = 36864 + j;
		d[36864 + j] = D[144][j];
	}
	D[145] = "�����������������������������������������������������������������멇멊멌멏멐멑멒멖멗멙멚멛멝멞멟멠멡멢멣멦멪멫멬멭멮멯������멲멳멵멶멷멹멺멻멼멽멾멿몀몁몂몆몈몉몊몋몍몎몏몐몑몒������몓몔몕몖몗몘몙몚몛몜몝몞몟몠몡몢몣몤몥몦몧몪몭몮몯몱몳몴몵몶몷몺몼몾몿뫀뫁뫂뫃뫅뫆뫇뫉뫊뫋뫌뫍뫎뫏뫐뫑뫒뫓뫔뫕뫖뫗뫚뫛뫜뫝뫞뫟뫠뫡뫢뫣뫤뫥뫦뫧뫨뫩뫪뫫뫬뫭뫮뫯뫰뫱뫲뫳뫴뫵뫶뫷뫸뫹뫺뫻뫽뫾뫿묁묂묃묅묆묇묈묉묊묋묌묎묐묒묓묔묕묖묗묙묚묛묝묞묟묡묢묣묤묥묦묧�".split("");
	for (j = 0; j != D[145].length; ++j) if (D[145][j].charCodeAt(0) !== 65533) {
		e[D[145][j]] = 37120 + j;
		d[37120 + j] = D[145][j];
	}
	D[146] = "�����������������������������������������������������������������묨묪묬묭묮묯묰묱묲묳묷묹묺묿뭀뭁뭂뭃뭆뭈뭊뭋뭌뭎뭑뭒������뭓뭕뭖뭗뭙뭚뭛뭜뭝뭞뭟뭠뭢뭤뭥뭦뭧뭨뭩뭪뭫뭭뭮뭯뭰뭱������뭲뭳뭴뭵뭶뭷뭸뭹뭺뭻뭼뭽뭾뭿뮀뮁뮂뮃뮄뮅뮆뮇뮉뮊뮋뮍뮎뮏뮑뮒뮓뮔뮕뮖뮗뮘뮙뮚뮛뮜뮝뮞뮟뮠뮡뮢뮣뮥뮦뮧뮩뮪뮫뮭뮮뮯뮰뮱뮲뮳뮵뮶뮸뮹뮺뮻뮼뮽뮾뮿믁믂믃믅믆믇믉믊믋믌믍믎믏믑믒믔믕믖믗믘믙믚믛믜믝믞믟믠믡믢믣믤믥믦믧믨믩믪믫믬믭믮믯믰믱믲믳믴믵믶믷믺믻믽믾밁�".split("");
	for (j = 0; j != D[146].length; ++j) if (D[146][j].charCodeAt(0) !== 65533) {
		e[D[146][j]] = 37376 + j;
		d[37376 + j] = D[146][j];
	}
	D[147] = "�����������������������������������������������������������������밃밄밅밆밇밊밎밐밒밓밙밚밠밡밢밣밦밨밪밫밬밮밯밲밳밵������밶밷밹밺밻밼밽밾밿뱂뱆뱇뱈뱊뱋뱎뱏뱑뱒뱓뱔뱕뱖뱗뱘뱙������뱚뱛뱜뱞뱟뱠뱡뱢뱣뱤뱥뱦뱧뱨뱩뱪뱫뱬뱭뱮뱯뱰뱱뱲뱳뱴뱵뱶뱷뱸뱹뱺뱻뱼뱽뱾뱿벀벁벂벃벆벇벉벊벍벏벐벑벒벓벖벘벛벜벝벞벟벢벣벥벦벩벪벫벬벭벮벯벲벶벷벸벹벺벻벾벿볁볂볃볅볆볇볈볉볊볋볌볎볒볓볔볖볗볙볚볛볝볞볟볠볡볢볣볤볥볦볧볨볩볪볫볬볭볮볯볰볱볲볳볷볹볺볻볽�".split("");
	for (j = 0; j != D[147].length; ++j) if (D[147][j].charCodeAt(0) !== 65533) {
		e[D[147][j]] = 37632 + j;
		d[37632 + j] = D[147][j];
	}
	D[148] = "�����������������������������������������������������������������볾볿봀봁봂봃봆봈봊봋봌봍봎봏봑봒봓봕봖봗봘봙봚봛봜봝������봞봟봠봡봢봣봥봦봧봨봩봪봫봭봮봯봰봱봲봳봴봵봶봷봸봹������봺봻봼봽봾봿뵁뵂뵃뵄뵅뵆뵇뵊뵋뵍뵎뵏뵑뵒뵓뵔뵕뵖뵗뵚뵛뵜뵝뵞뵟뵠뵡뵢뵣뵥뵦뵧뵩뵪뵫뵬뵭뵮뵯뵰뵱뵲뵳뵴뵵뵶뵷뵸뵹뵺뵻뵼뵽뵾뵿붂붃붅붆붋붌붍붎붏붒붔붖붗붘붛붝붞붟붠붡붢붣붥붦붧붨붩붪붫붬붭붮붯붱붲붳붴붵붶붷붹붺붻붼붽붾붿뷀뷁뷂뷃뷄뷅뷆뷇뷈뷉뷊뷋뷌뷍뷎뷏뷐뷑�".split("");
	for (j = 0; j != D[148].length; ++j) if (D[148][j].charCodeAt(0) !== 65533) {
		e[D[148][j]] = 37888 + j;
		d[37888 + j] = D[148][j];
	}
	D[149] = "�����������������������������������������������������������������뷒뷓뷖뷗뷙뷚뷛뷝뷞뷟뷠뷡뷢뷣뷤뷥뷦뷧뷨뷪뷫뷬뷭뷮뷯뷱������뷲뷳뷵뷶뷷뷹뷺뷻뷼뷽뷾뷿븁븂븄븆븇븈븉븊븋븎븏븑븒븓������븕븖븗븘븙븚븛븞븠븡븢븣븤븥븦븧븨븩븪븫븬븭븮븯븰븱븲븳븴븵븶븷븸븹븺븻븼븽븾븿빀빁빂빃빆빇빉빊빋빍빏빐빑빒빓빖빘빜빝빞빟빢빣빥빦빧빩빫빬빭빮빯빲빶빷빸빹빺빾빿뺁뺂뺃뺅뺆뺇뺈뺉뺊뺋뺎뺒뺓뺔뺕뺖뺗뺚뺛뺜뺝뺞뺟뺠뺡뺢뺣뺤뺥뺦뺧뺩뺪뺫뺬뺭뺮뺯뺰뺱뺲뺳뺴뺵뺶뺷�".split("");
	for (j = 0; j != D[149].length; ++j) if (D[149][j].charCodeAt(0) !== 65533) {
		e[D[149][j]] = 38144 + j;
		d[38144 + j] = D[149][j];
	}
	D[150] = "�����������������������������������������������������������������뺸뺹뺺뺻뺼뺽뺾뺿뻀뻁뻂뻃뻄뻅뻆뻇뻈뻉뻊뻋뻌뻍뻎뻏뻒뻓������뻕뻖뻙뻚뻛뻜뻝뻞뻟뻡뻢뻦뻧뻨뻩뻪뻫뻭뻮뻯뻰뻱뻲뻳뻴뻵������뻶뻷뻸뻹뻺뻻뻼뻽뻾뻿뼀뼂뼃뼄뼅뼆뼇뼊뼋뼌뼍뼎뼏뼐뼑뼒뼓뼔뼕뼖뼗뼚뼞뼟뼠뼡뼢뼣뼤뼥뼦뼧뼨뼩뼪뼫뼬뼭뼮뼯뼰뼱뼲뼳뼴뼵뼶뼷뼸뼹뼺뼻뼼뼽뼾뼿뽂뽃뽅뽆뽇뽉뽊뽋뽌뽍뽎뽏뽒뽓뽔뽖뽗뽘뽙뽚뽛뽜뽝뽞뽟뽠뽡뽢뽣뽤뽥뽦뽧뽨뽩뽪뽫뽬뽭뽮뽯뽰뽱뽲뽳뽴뽵뽶뽷뽸뽹뽺뽻뽼뽽뽾뽿뾀뾁뾂�".split("");
	for (j = 0; j != D[150].length; ++j) if (D[150][j].charCodeAt(0) !== 65533) {
		e[D[150][j]] = 38400 + j;
		d[38400 + j] = D[150][j];
	}
	D[151] = "�����������������������������������������������������������������뾃뾄뾅뾆뾇뾈뾉뾊뾋뾌뾍뾎뾏뾐뾑뾒뾓뾕뾖뾗뾘뾙뾚뾛뾜뾝������뾞뾟뾠뾡뾢뾣뾤뾥뾦뾧뾨뾩뾪뾫뾬뾭뾮뾯뾱뾲뾳뾴뾵뾶뾷뾸������뾹뾺뾻뾼뾽뾾뾿뿀뿁뿂뿃뿄뿆뿇뿈뿉뿊뿋뿎뿏뿑뿒뿓뿕뿖뿗뿘뿙뿚뿛뿝뿞뿠뿢뿣뿤뿥뿦뿧뿨뿩뿪뿫뿬뿭뿮뿯뿰뿱뿲뿳뿴뿵뿶뿷뿸뿹뿺뿻뿼뿽뿾뿿쀀쀁쀂쀃쀄쀅쀆쀇쀈쀉쀊쀋쀌쀍쀎쀏쀐쀑쀒쀓쀔쀕쀖쀗쀘쀙쀚쀛쀜쀝쀞쀟쀠쀡쀢쀣쀤쀥쀦쀧쀨쀩쀪쀫쀬쀭쀮쀯쀰쀱쀲쀳쀴쀵쀶쀷쀸쀹쀺쀻쀽쀾쀿�".split("");
	for (j = 0; j != D[151].length; ++j) if (D[151][j].charCodeAt(0) !== 65533) {
		e[D[151][j]] = 38656 + j;
		d[38656 + j] = D[151][j];
	}
	D[152] = "�����������������������������������������������������������������쁀쁁쁂쁃쁄쁅쁆쁇쁈쁉쁊쁋쁌쁍쁎쁏쁐쁒쁓쁔쁕쁖쁗쁙쁚쁛������쁝쁞쁟쁡쁢쁣쁤쁥쁦쁧쁪쁫쁬쁭쁮쁯쁰쁱쁲쁳쁴쁵쁶쁷쁸쁹������쁺쁻쁼쁽쁾쁿삀삁삂삃삄삅삆삇삈삉삊삋삌삍삎삏삒삓삕삖삗삙삚삛삜삝삞삟삢삤삦삧삨삩삪삫삮삱삲삷삸삹삺삻삾샂샃샄샆샇샊샋샍샎샏샑샒샓샔샕샖샗샚샞샟샠샡샢샣샦샧샩샪샫샭샮샯샰샱샲샳샶샸샺샻샼샽샾샿섁섂섃섅섆섇섉섊섋섌섍섎섏섑섒섓섔섖섗섘섙섚섛섡섢섥섨섩섪섫섮�".split("");
	for (j = 0; j != D[152].length; ++j) if (D[152][j].charCodeAt(0) !== 65533) {
		e[D[152][j]] = 38912 + j;
		d[38912 + j] = D[152][j];
	}
	D[153] = "�����������������������������������������������������������������섲섳섴섵섷섺섻섽섾섿셁셂셃셄셅셆셇셊셎셏셐셑셒셓셖셗������셙셚셛셝셞셟셠셡셢셣셦셪셫셬셭셮셯셱셲셳셵셶셷셹셺셻������셼셽셾셿솀솁솂솃솄솆솇솈솉솊솋솏솑솒솓솕솗솘솙솚솛솞솠솢솣솤솦솧솪솫솭솮솯솱솲솳솴솵솶솷솸솹솺솻솼솾솿쇀쇁쇂쇃쇅쇆쇇쇉쇊쇋쇍쇎쇏쇐쇑쇒쇓쇕쇖쇙쇚쇛쇜쇝쇞쇟쇡쇢쇣쇥쇦쇧쇩쇪쇫쇬쇭쇮쇯쇲쇴쇵쇶쇷쇸쇹쇺쇻쇾쇿숁숂숃숅숆숇숈숉숊숋숎숐숒숓숔숕숖숗숚숛숝숞숡숢숣�".split("");
	for (j = 0; j != D[153].length; ++j) if (D[153][j].charCodeAt(0) !== 65533) {
		e[D[153][j]] = 39168 + j;
		d[39168 + j] = D[153][j];
	}
	D[154] = "�����������������������������������������������������������������숤숥숦숧숪숬숮숰숳숵숶숷숸숹숺숻숼숽숾숿쉀쉁쉂쉃쉄쉅������쉆쉇쉉쉊쉋쉌쉍쉎쉏쉒쉓쉕쉖쉗쉙쉚쉛쉜쉝쉞쉟쉡쉢쉣쉤쉦������쉧쉨쉩쉪쉫쉮쉯쉱쉲쉳쉵쉶쉷쉸쉹쉺쉻쉾슀슂슃슄슅슆슇슊슋슌슍슎슏슑슒슓슔슕슖슗슙슚슜슞슟슠슡슢슣슦슧슩슪슫슮슯슰슱슲슳슶슸슺슻슼슽슾슿싀싁싂싃싄싅싆싇싈싉싊싋싌싍싎싏싐싑싒싓싔싕싖싗싘싙싚싛싞싟싡싢싥싦싧싨싩싪싮싰싲싳싴싵싷싺싽싾싿쌁쌂쌃쌄쌅쌆쌇쌊쌋쌎쌏�".split("");
	for (j = 0; j != D[154].length; ++j) if (D[154][j].charCodeAt(0) !== 65533) {
		e[D[154][j]] = 39424 + j;
		d[39424 + j] = D[154][j];
	}
	D[155] = "�����������������������������������������������������������������쌐쌑쌒쌖쌗쌙쌚쌛쌝쌞쌟쌠쌡쌢쌣쌦쌧쌪쌫쌬쌭쌮쌯쌰쌱쌲������쌳쌴쌵쌶쌷쌸쌹쌺쌻쌼쌽쌾쌿썀썁썂썃썄썆썇썈썉썊썋썌썍������썎썏썐썑썒썓썔썕썖썗썘썙썚썛썜썝썞썟썠썡썢썣썤썥썦썧썪썫썭썮썯썱썳썴썵썶썷썺썻썾썿쎀쎁쎂쎃쎅쎆쎇쎉쎊쎋쎍쎎쎏쎐쎑쎒쎓쎔쎕쎖쎗쎘쎙쎚쎛쎜쎝쎞쎟쎠쎡쎢쎣쎤쎥쎦쎧쎨쎩쎪쎫쎬쎭쎮쎯쎰쎱쎲쎳쎴쎵쎶쎷쎸쎹쎺쎻쎼쎽쎾쎿쏁쏂쏃쏄쏅쏆쏇쏈쏉쏊쏋쏌쏍쏎쏏쏐쏑쏒쏓쏔쏕쏖쏗쏚�".split("");
	for (j = 0; j != D[155].length; ++j) if (D[155][j].charCodeAt(0) !== 65533) {
		e[D[155][j]] = 39680 + j;
		d[39680 + j] = D[155][j];
	}
	D[156] = "�����������������������������������������������������������������쏛쏝쏞쏡쏣쏤쏥쏦쏧쏪쏫쏬쏮쏯쏰쏱쏲쏳쏶쏷쏹쏺쏻쏼쏽쏾������쏿쐀쐁쐂쐃쐄쐅쐆쐇쐉쐊쐋쐌쐍쐎쐏쐑쐒쐓쐔쐕쐖쐗쐘쐙쐚������쐛쐜쐝쐞쐟쐠쐡쐢쐣쐥쐦쐧쐨쐩쐪쐫쐭쐮쐯쐱쐲쐳쐵쐶쐷쐸쐹쐺쐻쐾쐿쑀쑁쑂쑃쑄쑅쑆쑇쑉쑊쑋쑌쑍쑎쑏쑐쑑쑒쑓쑔쑕쑖쑗쑘쑙쑚쑛쑜쑝쑞쑟쑠쑡쑢쑣쑦쑧쑩쑪쑫쑭쑮쑯쑰쑱쑲쑳쑶쑷쑸쑺쑻쑼쑽쑾쑿쒁쒂쒃쒄쒅쒆쒇쒈쒉쒊쒋쒌쒍쒎쒏쒐쒑쒒쒓쒕쒖쒗쒘쒙쒚쒛쒝쒞쒟쒠쒡쒢쒣쒤쒥쒦쒧쒨쒩�".split("");
	for (j = 0; j != D[156].length; ++j) if (D[156][j].charCodeAt(0) !== 65533) {
		e[D[156][j]] = 39936 + j;
		d[39936 + j] = D[156][j];
	}
	D[157] = "�����������������������������������������������������������������쒪쒫쒬쒭쒮쒯쒰쒱쒲쒳쒴쒵쒶쒷쒹쒺쒻쒽쒾쒿쓀쓁쓂쓃쓄쓅������쓆쓇쓈쓉쓊쓋쓌쓍쓎쓏쓐쓑쓒쓓쓔쓕쓖쓗쓘쓙쓚쓛쓜쓝쓞쓟������쓠쓡쓢쓣쓤쓥쓦쓧쓨쓪쓫쓬쓭쓮쓯쓲쓳쓵쓶쓷쓹쓻쓼쓽쓾씂씃씄씅씆씇씈씉씊씋씍씎씏씑씒씓씕씖씗씘씙씚씛씝씞씟씠씡씢씣씤씥씦씧씪씫씭씮씯씱씲씳씴씵씶씷씺씼씾씿앀앁앂앃앆앇앋앏앐앑앒앖앚앛앜앟앢앣앥앦앧앩앪앫앬앭앮앯앲앶앷앸앹앺앻앾앿얁얂얃얅얆얈얉얊얋얎얐얒얓얔�".split("");
	for (j = 0; j != D[157].length; ++j) if (D[157][j].charCodeAt(0) !== 65533) {
		e[D[157][j]] = 40192 + j;
		d[40192 + j] = D[157][j];
	}
	D[158] = "�����������������������������������������������������������������얖얙얚얛얝얞얟얡얢얣얤얥얦얧얨얪얫얬얭얮얯얰얱얲얳얶������얷얺얿엀엁엂엃엋엍엏엒엓엕엖엗엙엚엛엜엝엞엟엢엤엦엧������엨엩엪엫엯엱엲엳엵엸엹엺엻옂옃옄옉옊옋옍옎옏옑옒옓옔옕옖옗옚옝옞옟옠옡옢옣옦옧옩옪옫옯옱옲옶옸옺옼옽옾옿왂왃왅왆왇왉왊왋왌왍왎왏왒왖왗왘왙왚왛왞왟왡왢왣왤왥왦왧왨왩왪왫왭왮왰왲왳왴왵왶왷왺왻왽왾왿욁욂욃욄욅욆욇욊욌욎욏욐욑욒욓욖욗욙욚욛욝욞욟욠욡욢욣욦�".split("");
	for (j = 0; j != D[158].length; ++j) if (D[158][j].charCodeAt(0) !== 65533) {
		e[D[158][j]] = 40448 + j;
		d[40448 + j] = D[158][j];
	}
	D[159] = "�����������������������������������������������������������������욨욪욫욬욭욮욯욲욳욵욶욷욻욼욽욾욿웂웄웆웇웈웉웊웋웎������웏웑웒웓웕웖웗웘웙웚웛웞웟웢웣웤웥웦웧웪웫웭웮웯웱웲������웳웴웵웶웷웺웻웼웾웿윀윁윂윃윆윇윉윊윋윍윎윏윐윑윒윓윖윘윚윛윜윝윞윟윢윣윥윦윧윩윪윫윬윭윮윯윲윴윶윸윹윺윻윾윿읁읂읃읅읆읇읈읉읋읎읐읙읚읛읝읞읟읡읢읣읤읥읦읧읩읪읬읭읮읯읰읱읲읳읶읷읹읺읻읿잀잁잂잆잋잌잍잏잒잓잕잙잛잜잝잞잟잢잧잨잩잪잫잮잯잱잲잳잵잶잷�".split("");
	for (j = 0; j != D[159].length; ++j) if (D[159][j].charCodeAt(0) !== 65533) {
		e[D[159][j]] = 40704 + j;
		d[40704 + j] = D[159][j];
	}
	D[160] = "�����������������������������������������������������������������잸잹잺잻잾쟂쟃쟄쟅쟆쟇쟊쟋쟍쟏쟑쟒쟓쟔쟕쟖쟗쟙쟚쟛쟜������쟞쟟쟠쟡쟢쟣쟥쟦쟧쟩쟪쟫쟭쟮쟯쟰쟱쟲쟳쟴쟵쟶쟷쟸쟹쟺������쟻쟼쟽쟾쟿젂젃젅젆젇젉젋젌젍젎젏젒젔젗젘젙젚젛젞젟젡젢젣젥젦젧젨젩젪젫젮젰젲젳젴젵젶젷젹젺젻젽젾젿졁졂졃졄졅졆졇졊졋졎졏졐졑졒졓졕졖졗졘졙졚졛졜졝졞졟졠졡졢졣졤졥졦졧졨졩졪졫졬졭졮졯졲졳졵졶졷졹졻졼졽졾졿좂좄좈좉좊좎좏좐좑좒좓좕좖좗좘좙좚좛좜좞좠좢좣좤�".split("");
	for (j = 0; j != D[160].length; ++j) if (D[160][j].charCodeAt(0) !== 65533) {
		e[D[160][j]] = 40960 + j;
		d[40960 + j] = D[160][j];
	}
	D[161] = "�����������������������������������������������������������������좥좦좧좩좪좫좬좭좮좯좰좱좲좳좴좵좶좷좸좹좺좻좾좿죀죁������죂죃죅죆죇죉죊죋죍죎죏죐죑죒죓죖죘죚죛죜죝죞죟죢죣죥������죦죧죨죩죪죫죬죭죮죯죰죱죲죳죴죶죷죸죹죺죻죾죿줁줂줃줇줈줉줊줋줎　、。·‥…¨〃­―∥＼∼‘’“”〔〕〈〉《》「」『』【】±×÷≠≤≥∞∴°′″℃Å￠￡￥♂♀∠⊥⌒∂∇≡≒§※☆★○●◎◇◆□■△▲▽▼→←↑↓↔〓≪≫√∽∝∵∫∬∈∋⊆⊇⊂⊃∪∩∧∨￢�".split("");
	for (j = 0; j != D[161].length; ++j) if (D[161][j].charCodeAt(0) !== 65533) {
		e[D[161][j]] = 41216 + j;
		d[41216 + j] = D[161][j];
	}
	D[162] = "�����������������������������������������������������������������줐줒줓줔줕줖줗줙줚줛줜줝줞줟줠줡줢줣줤줥줦줧줨줩줪줫������줭줮줯줰줱줲줳줵줶줷줸줹줺줻줼줽줾줿쥀쥁쥂쥃쥄쥅쥆쥇������쥈쥉쥊쥋쥌쥍쥎쥏쥒쥓쥕쥖쥗쥙쥚쥛쥜쥝쥞쥟쥢쥤쥥쥦쥧쥨쥩쥪쥫쥭쥮쥯⇒⇔∀∃´～ˇ˘˝˚˙¸˛¡¿ː∮∑∏¤℉‰◁◀▷▶♤♠♡♥♧♣⊙◈▣◐◑▒▤▥▨▧▦▩♨☏☎☜☞¶†‡↕↗↙↖↘♭♩♪♬㉿㈜№㏇™㏂㏘℡€®������������������������".split("");
	for (j = 0; j != D[162].length; ++j) if (D[162][j].charCodeAt(0) !== 65533) {
		e[D[162][j]] = 41472 + j;
		d[41472 + j] = D[162][j];
	}
	D[163] = "�����������������������������������������������������������������쥱쥲쥳쥵쥶쥷쥸쥹쥺쥻쥽쥾쥿즀즁즂즃즄즅즆즇즊즋즍즎즏������즑즒즓즔즕즖즗즚즜즞즟즠즡즢즣즤즥즦즧즨즩즪즫즬즭즮������즯즰즱즲즳즴즵즶즷즸즹즺즻즼즽즾즿짂짃짅짆짉짋짌짍짎짏짒짔짗짘짛！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［￦］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝￣�".split("");
	for (j = 0; j != D[163].length; ++j) if (D[163][j].charCodeAt(0) !== 65533) {
		e[D[163][j]] = 41728 + j;
		d[41728 + j] = D[163][j];
	}
	D[164] = "�����������������������������������������������������������������짞짟짡짣짥짦짨짩짪짫짮짲짳짴짵짶짷짺짻짽짾짿쨁쨂쨃쨄������쨅쨆쨇쨊쨎쨏쨐쨑쨒쨓쨕쨖쨗쨙쨚쨛쨜쨝쨞쨟쨠쨡쨢쨣쨤쨥������쨦쨧쨨쨪쨫쨬쨭쨮쨯쨰쨱쨲쨳쨴쨵쨶쨷쨸쨹쨺쨻쨼쨽쨾쨿쩀쩁쩂쩃쩄쩅쩆ㄱㄲㄳㄴㄵㄶㄷㄸㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅃㅄㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣㅤㅥㅦㅧㅨㅩㅪㅫㅬㅭㅮㅯㅰㅱㅲㅳㅴㅵㅶㅷㅸㅹㅺㅻㅼㅽㅾㅿㆀㆁㆂㆃㆄㆅㆆㆇㆈㆉㆊㆋㆌㆍㆎ�".split("");
	for (j = 0; j != D[164].length; ++j) if (D[164][j].charCodeAt(0) !== 65533) {
		e[D[164][j]] = 41984 + j;
		d[41984 + j] = D[164][j];
	}
	D[165] = "�����������������������������������������������������������������쩇쩈쩉쩊쩋쩎쩏쩑쩒쩓쩕쩖쩗쩘쩙쩚쩛쩞쩢쩣쩤쩥쩦쩧쩩쩪������쩫쩬쩭쩮쩯쩰쩱쩲쩳쩴쩵쩶쩷쩸쩹쩺쩻쩼쩾쩿쪀쪁쪂쪃쪅쪆������쪇쪈쪉쪊쪋쪌쪍쪎쪏쪐쪑쪒쪓쪔쪕쪖쪗쪙쪚쪛쪜쪝쪞쪟쪠쪡쪢쪣쪤쪥쪦쪧ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ�����ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ�������ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ��������αβγδεζηθικλμνξοπρστυφχψω�������".split("");
	for (j = 0; j != D[165].length; ++j) if (D[165][j].charCodeAt(0) !== 65533) {
		e[D[165][j]] = 42240 + j;
		d[42240 + j] = D[165][j];
	}
	D[166] = "�����������������������������������������������������������������쪨쪩쪪쪫쪬쪭쪮쪯쪰쪱쪲쪳쪴쪵쪶쪷쪸쪹쪺쪻쪾쪿쫁쫂쫃쫅������쫆쫇쫈쫉쫊쫋쫎쫐쫒쫔쫕쫖쫗쫚쫛쫜쫝쫞쫟쫡쫢쫣쫤쫥쫦쫧������쫨쫩쫪쫫쫭쫮쫯쫰쫱쫲쫳쫵쫶쫷쫸쫹쫺쫻쫼쫽쫾쫿쬀쬁쬂쬃쬄쬅쬆쬇쬉쬊─│┌┐┘└├┬┤┴┼━┃┏┓┛┗┣┳┫┻╋┠┯┨┷┿┝┰┥┸╂┒┑┚┙┖┕┎┍┞┟┡┢┦┧┩┪┭┮┱┲┵┶┹┺┽┾╀╁╃╄╅╆╇╈╉╊���������������������������".split("");
	for (j = 0; j != D[166].length; ++j) if (D[166][j].charCodeAt(0) !== 65533) {
		e[D[166][j]] = 42496 + j;
		d[42496 + j] = D[166][j];
	}
	D[167] = "�����������������������������������������������������������������쬋쬌쬍쬎쬏쬑쬒쬓쬕쬖쬗쬙쬚쬛쬜쬝쬞쬟쬢쬣쬤쬥쬦쬧쬨쬩������쬪쬫쬬쬭쬮쬯쬰쬱쬲쬳쬴쬵쬶쬷쬸쬹쬺쬻쬼쬽쬾쬿쭀쭂쭃쭄������쭅쭆쭇쭊쭋쭍쭎쭏쭑쭒쭓쭔쭕쭖쭗쭚쭛쭜쭞쭟쭠쭡쭢쭣쭥쭦쭧쭨쭩쭪쭫쭬㎕㎖㎗ℓ㎘㏄㎣㎤㎥㎦㎙㎚㎛㎜㎝㎞㎟㎠㎡㎢㏊㎍㎎㎏㏏㎈㎉㏈㎧㎨㎰㎱㎲㎳㎴㎵㎶㎷㎸㎹㎀㎁㎂㎃㎄㎺㎻㎼㎽㎾㎿㎐㎑㎒㎓㎔Ω㏀㏁㎊㎋㎌㏖㏅㎭㎮㎯㏛㎩㎪㎫㎬㏝㏐㏓㏃㏉㏜㏆����������������".split("");
	for (j = 0; j != D[167].length; ++j) if (D[167][j].charCodeAt(0) !== 65533) {
		e[D[167][j]] = 42752 + j;
		d[42752 + j] = D[167][j];
	}
	D[168] = "�����������������������������������������������������������������쭭쭮쭯쭰쭱쭲쭳쭴쭵쭶쭷쭺쭻쭼쭽쭾쭿쮀쮁쮂쮃쮄쮅쮆쮇쮈������쮉쮊쮋쮌쮍쮎쮏쮐쮑쮒쮓쮔쮕쮖쮗쮘쮙쮚쮛쮝쮞쮟쮠쮡쮢쮣������쮤쮥쮦쮧쮨쮩쮪쮫쮬쮭쮮쮯쮰쮱쮲쮳쮴쮵쮶쮷쮹쮺쮻쮼쮽쮾쮿쯀쯁쯂쯃쯄ÆÐªĦ�Ĳ�ĿŁØŒºÞŦŊ�㉠㉡㉢㉣㉤㉥㉦㉧㉨㉩㉪㉫㉬㉭㉮㉯㉰㉱㉲㉳㉴㉵㉶㉷㉸㉹㉺㉻ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮½⅓⅔¼¾⅛⅜⅝⅞�".split("");
	for (j = 0; j != D[168].length; ++j) if (D[168][j].charCodeAt(0) !== 65533) {
		e[D[168][j]] = 43008 + j;
		d[43008 + j] = D[168][j];
	}
	D[169] = "�����������������������������������������������������������������쯅쯆쯇쯈쯉쯊쯋쯌쯍쯎쯏쯐쯑쯒쯓쯕쯖쯗쯘쯙쯚쯛쯜쯝쯞쯟������쯠쯡쯢쯣쯥쯦쯨쯪쯫쯬쯭쯮쯯쯰쯱쯲쯳쯴쯵쯶쯷쯸쯹쯺쯻쯼������쯽쯾쯿찀찁찂찃찄찅찆찇찈찉찊찋찎찏찑찒찓찕찖찗찘찙찚찛찞찟찠찣찤æđðħıĳĸŀłøœßþŧŋŉ㈀㈁㈂㈃㈄㈅㈆㈇㈈㈉㈊㈋㈌㈍㈎㈏㈐㈑㈒㈓㈔㈕㈖㈗㈘㈙㈚㈛⒜⒝⒞⒟⒠⒡⒢⒣⒤⒥⒦⒧⒨⒩⒪⒫⒬⒭⒮⒯⒰⒱⒲⒳⒴⒵⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂¹²³⁴ⁿ₁₂₃₄�".split("");
	for (j = 0; j != D[169].length; ++j) if (D[169][j].charCodeAt(0) !== 65533) {
		e[D[169][j]] = 43264 + j;
		d[43264 + j] = D[169][j];
	}
	D[170] = "�����������������������������������������������������������������찥찦찪찫찭찯찱찲찳찴찵찶찷찺찿챀챁챂챃챆챇챉챊챋챍챎������챏챐챑챒챓챖챚챛챜챝챞챟챡챢챣챥챧챩챪챫챬챭챮챯챱챲������챳챴챶챷챸챹챺챻챼챽챾챿첀첁첂첃첄첅첆첇첈첉첊첋첌첍첎첏첐첑첒첓ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをん������������".split("");
	for (j = 0; j != D[170].length; ++j) if (D[170][j].charCodeAt(0) !== 65533) {
		e[D[170][j]] = 43520 + j;
		d[43520 + j] = D[170][j];
	}
	D[171] = "�����������������������������������������������������������������첔첕첖첗첚첛첝첞첟첡첢첣첤첥첦첧첪첮첯첰첱첲첳첶첷첹������첺첻첽첾첿쳀쳁쳂쳃쳆쳈쳊쳋쳌쳍쳎쳏쳑쳒쳓쳕쳖쳗쳘쳙쳚������쳛쳜쳝쳞쳟쳠쳡쳢쳣쳥쳦쳧쳨쳩쳪쳫쳭쳮쳯쳱쳲쳳쳴쳵쳶쳷쳸쳹쳺쳻쳼쳽ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ���������".split("");
	for (j = 0; j != D[171].length; ++j) if (D[171][j].charCodeAt(0) !== 65533) {
		e[D[171][j]] = 43776 + j;
		d[43776 + j] = D[171][j];
	}
	D[172] = "�����������������������������������������������������������������쳾쳿촀촂촃촄촅촆촇촊촋촍촎촏촑촒촓촔촕촖촗촚촜촞촟촠������촡촢촣촥촦촧촩촪촫촭촮촯촰촱촲촳촴촵촶촷촸촺촻촼촽촾������촿쵀쵁쵂쵃쵄쵅쵆쵇쵈쵉쵊쵋쵌쵍쵎쵏쵐쵑쵒쵓쵔쵕쵖쵗쵘쵙쵚쵛쵝쵞쵟АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ���������������абвгдеёжзийклмнопрстуфхцчшщъыьэюя��������������".split("");
	for (j = 0; j != D[172].length; ++j) if (D[172][j].charCodeAt(0) !== 65533) {
		e[D[172][j]] = 44032 + j;
		d[44032 + j] = D[172][j];
	}
	D[173] = "�����������������������������������������������������������������쵡쵢쵣쵥쵦쵧쵨쵩쵪쵫쵮쵰쵲쵳쵴쵵쵶쵷쵹쵺쵻쵼쵽쵾쵿춀������춁춂춃춄춅춆춇춉춊춋춌춍춎춏춐춑춒춓춖춗춙춚춛춝춞춟������춠춡춢춣춦춨춪춫춬춭춮춯춱춲춳춴춵춶춷춸춹춺춻춼춽춾춿췀췁췂췃췅�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[173].length; ++j) if (D[173][j].charCodeAt(0) !== 65533) {
		e[D[173][j]] = 44288 + j;
		d[44288 + j] = D[173][j];
	}
	D[174] = "�����������������������������������������������������������������췆췇췈췉췊췋췍췎췏췑췒췓췔췕췖췗췘췙췚췛췜췝췞췟췠췡������췢췣췤췥췦췧췩췪췫췭췮췯췱췲췳췴췵췶췷췺췼췾췿츀츁츂������츃츅츆츇츉츊츋츍츎츏츐츑츒츓츕츖츗츘츚츛츜츝츞츟츢츣츥츦츧츩츪츫�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[174].length; ++j) if (D[174][j].charCodeAt(0) !== 65533) {
		e[D[174][j]] = 44544 + j;
		d[44544 + j] = D[174][j];
	}
	D[175] = "�����������������������������������������������������������������츬츭츮츯츲츴츶츷츸츹츺츻츼츽츾츿칀칁칂칃칄칅칆칇칈칉������칊칋칌칍칎칏칐칑칒칓칔칕칖칗칚칛칝칞칢칣칤칥칦칧칪칬������칮칯칰칱칲칳칶칷칹칺칻칽칾칿캀캁캂캃캆캈캊캋캌캍캎캏캒캓캕캖캗캙�����������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[175].length; ++j) if (D[175][j].charCodeAt(0) !== 65533) {
		e[D[175][j]] = 44800 + j;
		d[44800 + j] = D[175][j];
	}
	D[176] = "�����������������������������������������������������������������캚캛캜캝캞캟캢캦캧캨캩캪캫캮캯캰캱캲캳캴캵캶캷캸캹캺������캻캼캽캾캿컀컂컃컄컅컆컇컈컉컊컋컌컍컎컏컐컑컒컓컔컕������컖컗컘컙컚컛컜컝컞컟컠컡컢컣컦컧컩컪컭컮컯컰컱컲컳컶컺컻컼컽컾컿가각간갇갈갉갊감갑값갓갔강갖갗같갚갛개객갠갤갬갭갯갰갱갸갹갼걀걋걍걔걘걜거걱건걷걸걺검겁것겄겅겆겉겊겋게겐겔겜겝겟겠겡겨격겪견겯결겸겹겻겼경곁계곈곌곕곗고곡곤곧골곪곬곯곰곱곳공곶과곽관괄괆�".split("");
	for (j = 0; j != D[176].length; ++j) if (D[176][j].charCodeAt(0) !== 65533) {
		e[D[176][j]] = 45056 + j;
		d[45056 + j] = D[176][j];
	}
	D[177] = "�����������������������������������������������������������������켂켃켅켆켇켉켊켋켌켍켎켏켒켔켖켗켘켙켚켛켝켞켟켡켢켣������켥켦켧켨켩켪켫켮켲켳켴켵켶켷켹켺켻켼켽켾켿콀콁콂콃콄������콅콆콇콈콉콊콋콌콍콎콏콐콑콒콓콖콗콙콚콛콝콞콟콠콡콢콣콦콨콪콫콬괌괍괏광괘괜괠괩괬괭괴괵괸괼굄굅굇굉교굔굘굡굣구국군굳굴굵굶굻굼굽굿궁궂궈궉권궐궜궝궤궷귀귁귄귈귐귑귓규균귤그극근귿글긁금급긋긍긔기긱긴긷길긺김깁깃깅깆깊까깍깎깐깔깖깜깝깟깠깡깥깨깩깬깰깸�".split("");
	for (j = 0; j != D[177].length; ++j) if (D[177][j].charCodeAt(0) !== 65533) {
		e[D[177][j]] = 45312 + j;
		d[45312 + j] = D[177][j];
	}
	D[178] = "�����������������������������������������������������������������콭콮콯콲콳콵콶콷콹콺콻콼콽콾콿쾁쾂쾃쾄쾆쾇쾈쾉쾊쾋쾍������쾎쾏쾐쾑쾒쾓쾔쾕쾖쾗쾘쾙쾚쾛쾜쾝쾞쾟쾠쾢쾣쾤쾥쾦쾧쾩������쾪쾫쾬쾭쾮쾯쾱쾲쾳쾴쾵쾶쾷쾸쾹쾺쾻쾼쾽쾾쾿쿀쿁쿂쿃쿅쿆쿇쿈쿉쿊쿋깹깻깼깽꺄꺅꺌꺼꺽꺾껀껄껌껍껏껐껑께껙껜껨껫껭껴껸껼꼇꼈꼍꼐꼬꼭꼰꼲꼴꼼꼽꼿꽁꽂꽃꽈꽉꽐꽜꽝꽤꽥꽹꾀꾄꾈꾐꾑꾕꾜꾸꾹꾼꿀꿇꿈꿉꿋꿍꿎꿔꿜꿨꿩꿰꿱꿴꿸뀀뀁뀄뀌뀐뀔뀜뀝뀨끄끅끈끊끌끎끓끔끕끗끙�".split("");
	for (j = 0; j != D[178].length; ++j) if (D[178][j].charCodeAt(0) !== 65533) {
		e[D[178][j]] = 45568 + j;
		d[45568 + j] = D[178][j];
	}
	D[179] = "�����������������������������������������������������������������쿌쿍쿎쿏쿐쿑쿒쿓쿔쿕쿖쿗쿘쿙쿚쿛쿜쿝쿞쿟쿢쿣쿥쿦쿧쿩������쿪쿫쿬쿭쿮쿯쿲쿴쿶쿷쿸쿹쿺쿻쿽쿾쿿퀁퀂퀃퀅퀆퀇퀈퀉퀊������퀋퀌퀍퀎퀏퀐퀒퀓퀔퀕퀖퀗퀙퀚퀛퀜퀝퀞퀟퀠퀡퀢퀣퀤퀥퀦퀧퀨퀩퀪퀫퀬끝끼끽낀낄낌낍낏낑나낙낚난낟날낡낢남납낫났낭낮낯낱낳내낵낸낼냄냅냇냈냉냐냑냔냘냠냥너넉넋넌널넒넓넘넙넛넜넝넣네넥넨넬넴넵넷넸넹녀녁년녈념녑녔녕녘녜녠노녹논놀놂놈놉놋농높놓놔놘놜놨뇌뇐뇔뇜뇝�".split("");
	for (j = 0; j != D[179].length; ++j) if (D[179][j].charCodeAt(0) !== 65533) {
		e[D[179][j]] = 45824 + j;
		d[45824 + j] = D[179][j];
	}
	D[180] = "�����������������������������������������������������������������퀮퀯퀰퀱퀲퀳퀶퀷퀹퀺퀻퀽퀾퀿큀큁큂큃큆큈큊큋큌큍큎큏������큑큒큓큕큖큗큙큚큛큜큝큞큟큡큢큣큤큥큦큧큨큩큪큫큮큯������큱큲큳큵큶큷큸큹큺큻큾큿킀킂킃킄킅킆킇킈킉킊킋킌킍킎킏킐킑킒킓킔뇟뇨뇩뇬뇰뇹뇻뇽누눅눈눋눌눔눕눗눙눠눴눼뉘뉜뉠뉨뉩뉴뉵뉼늄늅늉느늑는늘늙늚늠늡늣능늦늪늬늰늴니닉닌닐닒님닙닛닝닢다닥닦단닫달닭닮닯닳담답닷닸당닺닻닿대댁댄댈댐댑댓댔댕댜더덕덖던덛덜덞덟덤덥�".split("");
	for (j = 0; j != D[180].length; ++j) if (D[180][j].charCodeAt(0) !== 65533) {
		e[D[180][j]] = 46080 + j;
		d[46080 + j] = D[180][j];
	}
	D[181] = "�����������������������������������������������������������������킕킖킗킘킙킚킛킜킝킞킟킠킡킢킣킦킧킩킪킫킭킮킯킰킱킲������킳킶킸킺킻킼킽킾킿탂탃탅탆탇탊탋탌탍탎탏탒탖탗탘탙탚������탛탞탟탡탢탣탥탦탧탨탩탪탫탮탲탳탴탵탶탷탹탺탻탼탽탾탿턀턁턂턃턄덧덩덫덮데덱덴델뎀뎁뎃뎄뎅뎌뎐뎔뎠뎡뎨뎬도독돈돋돌돎돐돔돕돗동돛돝돠돤돨돼됐되된될됨됩됫됴두둑둔둘둠둡둣둥둬뒀뒈뒝뒤뒨뒬뒵뒷뒹듀듄듈듐듕드득든듣들듦듬듭듯등듸디딕딘딛딜딤딥딧딨딩딪따딱딴딸�".split("");
	for (j = 0; j != D[181].length; ++j) if (D[181][j].charCodeAt(0) !== 65533) {
		e[D[181][j]] = 46336 + j;
		d[46336 + j] = D[181][j];
	}
	D[182] = "�����������������������������������������������������������������턅턆턇턈턉턊턋턌턎턏턐턑턒턓턔턕턖턗턘턙턚턛턜턝턞턟������턠턡턢턣턤턥턦턧턨턩턪턫턬턭턮턯턲턳턵턶턷턹턻턼턽턾������턿텂텆텇텈텉텊텋텎텏텑텒텓텕텖텗텘텙텚텛텞텠텢텣텤텥텦텧텩텪텫텭땀땁땃땄땅땋때땍땐땔땜땝땟땠땡떠떡떤떨떪떫떰떱떳떴떵떻떼떽뗀뗄뗌뗍뗏뗐뗑뗘뗬또똑똔똘똥똬똴뙈뙤뙨뚜뚝뚠뚤뚫뚬뚱뛔뛰뛴뛸뜀뜁뜅뜨뜩뜬뜯뜰뜸뜹뜻띄띈띌띔띕띠띤띨띰띱띳띵라락란랄람랍랏랐랑랒랖랗�".split("");
	for (j = 0; j != D[182].length; ++j) if (D[182][j].charCodeAt(0) !== 65533) {
		e[D[182][j]] = 46592 + j;
		d[46592 + j] = D[182][j];
	}
	D[183] = "�����������������������������������������������������������������텮텯텰텱텲텳텴텵텶텷텸텹텺텻텽텾텿톀톁톂톃톅톆톇톉톊������톋톌톍톎톏톐톑톒톓톔톕톖톗톘톙톚톛톜톝톞톟톢톣톥톦톧������톩톪톫톬톭톮톯톲톴톶톷톸톹톻톽톾톿퇁퇂퇃퇄퇅퇆퇇퇈퇉퇊퇋퇌퇍퇎퇏래랙랜랠램랩랫랬랭랴략랸럇량러럭런럴럼럽럿렀렁렇레렉렌렐렘렙렛렝려력련렬렴렵렷렸령례롄롑롓로록론롤롬롭롯롱롸롼뢍뢨뢰뢴뢸룀룁룃룅료룐룔룝룟룡루룩룬룰룸룹룻룽뤄뤘뤠뤼뤽륀륄륌륏륑류륙륜률륨륩�".split("");
	for (j = 0; j != D[183].length; ++j) if (D[183][j].charCodeAt(0) !== 65533) {
		e[D[183][j]] = 46848 + j;
		d[46848 + j] = D[183][j];
	}
	D[184] = "�����������������������������������������������������������������퇐퇑퇒퇓퇔퇕퇖퇗퇙퇚퇛퇜퇝퇞퇟퇠퇡퇢퇣퇤퇥퇦퇧퇨퇩퇪������퇫퇬퇭퇮퇯퇰퇱퇲퇳퇵퇶퇷퇹퇺퇻퇼퇽퇾퇿툀툁툂툃툄툅툆������툈툊툋툌툍툎툏툑툒툓툔툕툖툗툘툙툚툛툜툝툞툟툠툡툢툣툤툥툦툧툨툩륫륭르륵른를름릅릇릉릊릍릎리릭린릴림립릿링마막만많맏말맑맒맘맙맛망맞맡맣매맥맨맬맴맵맷맸맹맺먀먁먈먕머먹먼멀멂멈멉멋멍멎멓메멕멘멜멤멥멧멨멩며멱면멸몃몄명몇몌모목몫몬몰몲몸몹못몽뫄뫈뫘뫙뫼�".split("");
	for (j = 0; j != D[184].length; ++j) if (D[184][j].charCodeAt(0) !== 65533) {
		e[D[184][j]] = 47104 + j;
		d[47104 + j] = D[184][j];
	}
	D[185] = "�����������������������������������������������������������������툪툫툮툯툱툲툳툵툶툷툸툹툺툻툾퉀퉂퉃퉄퉅퉆퉇퉉퉊퉋퉌������퉍퉎퉏퉐퉑퉒퉓퉔퉕퉖퉗퉘퉙퉚퉛퉝퉞퉟퉠퉡퉢퉣퉥퉦퉧퉨������퉩퉪퉫퉬퉭퉮퉯퉰퉱퉲퉳퉴퉵퉶퉷퉸퉹퉺퉻퉼퉽퉾퉿튂튃튅튆튇튉튊튋튌묀묄묍묏묑묘묜묠묩묫무묵묶문묻물묽묾뭄뭅뭇뭉뭍뭏뭐뭔뭘뭡뭣뭬뮈뮌뮐뮤뮨뮬뮴뮷므믄믈믐믓미믹민믿밀밂밈밉밋밌밍및밑바박밖밗반받발밝밞밟밤밥밧방밭배백밴밸뱀뱁뱃뱄뱅뱉뱌뱍뱐뱝버벅번벋벌벎범법벗�".split("");
	for (j = 0; j != D[185].length; ++j) if (D[185][j].charCodeAt(0) !== 65533) {
		e[D[185][j]] = 47360 + j;
		d[47360 + j] = D[185][j];
	}
	D[186] = "�����������������������������������������������������������������튍튎튏튒튓튔튖튗튘튙튚튛튝튞튟튡튢튣튥튦튧튨튩튪튫튭������튮튯튰튲튳튴튵튶튷튺튻튽튾틁틃틄틅틆틇틊틌틍틎틏틐틑������틒틓틕틖틗틙틚틛틝틞틟틠틡틢틣틦틧틨틩틪틫틬틭틮틯틲틳틵틶틷틹틺벙벚베벡벤벧벨벰벱벳벴벵벼벽변별볍볏볐병볕볘볜보복볶본볼봄봅봇봉봐봔봤봬뵀뵈뵉뵌뵐뵘뵙뵤뵨부북분붇불붉붊붐붑붓붕붙붚붜붤붰붸뷔뷕뷘뷜뷩뷰뷴뷸븀븃븅브븍븐블븜븝븟비빅빈빌빎빔빕빗빙빚빛빠빡빤�".split("");
	for (j = 0; j != D[186].length; ++j) if (D[186][j].charCodeAt(0) !== 65533) {
		e[D[186][j]] = 47616 + j;
		d[47616 + j] = D[186][j];
	}
	D[187] = "�����������������������������������������������������������������틻틼틽틾틿팂팄팆팇팈팉팊팋팏팑팒팓팕팗팘팙팚팛팞팢팣������팤팦팧팪팫팭팮팯팱팲팳팴팵팶팷팺팾팿퍀퍁퍂퍃퍆퍇퍈퍉������퍊퍋퍌퍍퍎퍏퍐퍑퍒퍓퍔퍕퍖퍗퍘퍙퍚퍛퍜퍝퍞퍟퍠퍡퍢퍣퍤퍥퍦퍧퍨퍩빨빪빰빱빳빴빵빻빼빽뺀뺄뺌뺍뺏뺐뺑뺘뺙뺨뻐뻑뻔뻗뻘뻠뻣뻤뻥뻬뼁뼈뼉뼘뼙뼛뼜뼝뽀뽁뽄뽈뽐뽑뽕뾔뾰뿅뿌뿍뿐뿔뿜뿟뿡쀼쁑쁘쁜쁠쁨쁩삐삑삔삘삠삡삣삥사삭삯산삳살삵삶삼삽삿샀상샅새색샌샐샘샙샛샜생샤�".split("");
	for (j = 0; j != D[187].length; ++j) if (D[187][j].charCodeAt(0) !== 65533) {
		e[D[187][j]] = 47872 + j;
		d[47872 + j] = D[187][j];
	}
	D[188] = "�����������������������������������������������������������������퍪퍫퍬퍭퍮퍯퍰퍱퍲퍳퍴퍵퍶퍷퍸퍹퍺퍻퍾퍿펁펂펃펅펆펇������펈펉펊펋펎펒펓펔펕펖펗펚펛펝펞펟펡펢펣펤펥펦펧펪펬펮������펯펰펱펲펳펵펶펷펹펺펻펽펾펿폀폁폂폃폆폇폊폋폌폍폎폏폑폒폓폔폕폖샥샨샬샴샵샷샹섀섄섈섐섕서석섞섟선섣설섦섧섬섭섯섰성섶세섹센셀셈셉셋셌셍셔셕션셜셤셥셧셨셩셰셴셸솅소속솎손솔솖솜솝솟송솥솨솩솬솰솽쇄쇈쇌쇔쇗쇘쇠쇤쇨쇰쇱쇳쇼쇽숀숄숌숍숏숑수숙순숟술숨숩숫숭�".split("");
	for (j = 0; j != D[188].length; ++j) if (D[188][j].charCodeAt(0) !== 65533) {
		e[D[188][j]] = 48128 + j;
		d[48128 + j] = D[188][j];
	}
	D[189] = "�����������������������������������������������������������������폗폙폚폛폜폝폞폟폠폢폤폥폦폧폨폩폪폫폮폯폱폲폳폵폶폷������폸폹폺폻폾퐀퐂퐃퐄퐅퐆퐇퐉퐊퐋퐌퐍퐎퐏퐐퐑퐒퐓퐔퐕퐖������퐗퐘퐙퐚퐛퐜퐞퐟퐠퐡퐢퐣퐤퐥퐦퐧퐨퐩퐪퐫퐬퐭퐮퐯퐰퐱퐲퐳퐴퐵퐶퐷숯숱숲숴쉈쉐쉑쉔쉘쉠쉥쉬쉭쉰쉴쉼쉽쉿슁슈슉슐슘슛슝스슥슨슬슭슴습슷승시식신싣실싫심십싯싱싶싸싹싻싼쌀쌈쌉쌌쌍쌓쌔쌕쌘쌜쌤쌥쌨쌩썅써썩썬썰썲썸썹썼썽쎄쎈쎌쏀쏘쏙쏜쏟쏠쏢쏨쏩쏭쏴쏵쏸쐈쐐쐤쐬쐰�".split("");
	for (j = 0; j != D[189].length; ++j) if (D[189][j].charCodeAt(0) !== 65533) {
		e[D[189][j]] = 48384 + j;
		d[48384 + j] = D[189][j];
	}
	D[190] = "�����������������������������������������������������������������퐸퐹퐺퐻퐼퐽퐾퐿푁푂푃푅푆푇푈푉푊푋푌푍푎푏푐푑푒푓������푔푕푖푗푘푙푚푛푝푞푟푡푢푣푥푦푧푨푩푪푫푬푮푰푱푲������푳푴푵푶푷푺푻푽푾풁풃풄풅풆풇풊풌풎풏풐풑풒풓풕풖풗풘풙풚풛풜풝쐴쐼쐽쑈쑤쑥쑨쑬쑴쑵쑹쒀쒔쒜쒸쒼쓩쓰쓱쓴쓸쓺쓿씀씁씌씐씔씜씨씩씬씰씸씹씻씽아악안앉않알앍앎앓암압앗았앙앝앞애액앤앨앰앱앳앴앵야약얀얄얇얌얍얏양얕얗얘얜얠얩어억언얹얻얼얽얾엄업없엇었엉엊엌엎�".split("");
	for (j = 0; j != D[190].length; ++j) if (D[190][j].charCodeAt(0) !== 65533) {
		e[D[190][j]] = 48640 + j;
		d[48640 + j] = D[190][j];
	}
	D[191] = "�����������������������������������������������������������������풞풟풠풡풢풣풤풥풦풧풨풪풫풬풭풮풯풰풱풲풳풴풵풶풷풸������풹풺풻풼풽풾풿퓀퓁퓂퓃퓄퓅퓆퓇퓈퓉퓊퓋퓍퓎퓏퓑퓒퓓퓕������퓖퓗퓘퓙퓚퓛퓝퓞퓠퓡퓢퓣퓤퓥퓦퓧퓩퓪퓫퓭퓮퓯퓱퓲퓳퓴퓵퓶퓷퓹퓺퓼에엑엔엘엠엡엣엥여역엮연열엶엷염엽엾엿였영옅옆옇예옌옐옘옙옛옜오옥온올옭옮옰옳옴옵옷옹옻와왁완왈왐왑왓왔왕왜왝왠왬왯왱외왹왼욀욈욉욋욍요욕욘욜욤욥욧용우욱운울욹욺움웁웃웅워웍원월웜웝웠웡웨�".split("");
	for (j = 0; j != D[191].length; ++j) if (D[191][j].charCodeAt(0) !== 65533) {
		e[D[191][j]] = 48896 + j;
		d[48896 + j] = D[191][j];
	}
	D[192] = "�����������������������������������������������������������������퓾퓿픀픁픂픃픅픆픇픉픊픋픍픎픏픐픑픒픓픖픘픙픚픛픜픝������픞픟픠픡픢픣픤픥픦픧픨픩픪픫픬픭픮픯픰픱픲픳픴픵픶픷������픸픹픺픻픾픿핁핂핃핅핆핇핈핉핊핋핎핐핒핓핔핕핖핗핚핛핝핞핟핡핢핣웩웬웰웸웹웽위윅윈윌윔윕윗윙유육윤율윰윱윳융윷으윽은을읊음읍읏응읒읓읔읕읖읗의읜읠읨읫이익인일읽읾잃임입잇있잉잊잎자작잔잖잗잘잚잠잡잣잤장잦재잭잰잴잼잽잿쟀쟁쟈쟉쟌쟎쟐쟘쟝쟤쟨쟬저적전절젊�".split("");
	for (j = 0; j != D[192].length; ++j) if (D[192][j].charCodeAt(0) !== 65533) {
		e[D[192][j]] = 49152 + j;
		d[49152 + j] = D[192][j];
	}
	D[193] = "�����������������������������������������������������������������핤핦핧핪핬핮핯핰핱핲핳핶핷핹핺핻핽핾핿햀햁햂햃햆햊햋������햌햍햎햏햑햒햓햔햕햖햗햘햙햚햛햜햝햞햟햠햡햢햣햤햦햧������햨햩햪햫햬햭햮햯햰햱햲햳햴햵햶햷햸햹햺햻햼햽햾햿헀헁헂헃헄헅헆헇점접젓정젖제젝젠젤젬젭젯젱져젼졀졈졉졌졍졔조족존졸졺좀좁좃종좆좇좋좌좍좔좝좟좡좨좼좽죄죈죌죔죕죗죙죠죡죤죵주죽준줄줅줆줌줍줏중줘줬줴쥐쥑쥔쥘쥠쥡쥣쥬쥰쥴쥼즈즉즌즐즘즙즛증지직진짇질짊짐집짓�".split("");
	for (j = 0; j != D[193].length; ++j) if (D[193][j].charCodeAt(0) !== 65533) {
		e[D[193][j]] = 49408 + j;
		d[49408 + j] = D[193][j];
	}
	D[194] = "�����������������������������������������������������������������헊헋헍헎헏헑헓헔헕헖헗헚헜헞헟헠헡헢헣헦헧헩헪헫헭헮������헯헰헱헲헳헶헸헺헻헼헽헾헿혂혃혅혆혇혉혊혋혌혍혎혏혒������혖혗혘혙혚혛혝혞혟혡혢혣혥혦혧혨혩혪혫혬혮혯혰혱혲혳혴혵혶혷혺혻징짖짙짚짜짝짠짢짤짧짬짭짯짰짱째짹짼쨀쨈쨉쨋쨌쨍쨔쨘쨩쩌쩍쩐쩔쩜쩝쩟쩠쩡쩨쩽쪄쪘쪼쪽쫀쫄쫌쫍쫏쫑쫓쫘쫙쫠쫬쫴쬈쬐쬔쬘쬠쬡쭁쭈쭉쭌쭐쭘쭙쭝쭤쭸쭹쮜쮸쯔쯤쯧쯩찌찍찐찔찜찝찡찢찧차착찬찮찰참찹찻�".split("");
	for (j = 0; j != D[194].length; ++j) if (D[194][j].charCodeAt(0) !== 65533) {
		e[D[194][j]] = 49664 + j;
		d[49664 + j] = D[194][j];
	}
	D[195] = "�����������������������������������������������������������������혽혾혿홁홂홃홄홆홇홊홌홎홏홐홒홓홖홗홙홚홛홝홞홟홠홡������홢홣홤홥홦홨홪홫홬홭홮홯홲홳홵홶홷홸홹홺홻홼홽홾홿횀������횁횂횄횆횇횈횉횊횋횎횏횑횒횓횕횖횗횘횙횚횛횜횞횠횢횣횤횥횦횧횩횪찼창찾채책챈챌챔챕챗챘챙챠챤챦챨챰챵처척천철첨첩첫첬청체첵첸첼쳄쳅쳇쳉쳐쳔쳤쳬쳰촁초촉촌촐촘촙촛총촤촨촬촹최쵠쵤쵬쵭쵯쵱쵸춈추축춘출춤춥춧충춰췄췌췐취췬췰췸췹췻췽츄츈츌츔츙츠측츤츨츰츱츳층�".split("");
	for (j = 0; j != D[195].length; ++j) if (D[195][j].charCodeAt(0) !== 65533) {
		e[D[195][j]] = 49920 + j;
		d[49920 + j] = D[195][j];
	}
	D[196] = "�����������������������������������������������������������������횫횭횮횯횱횲횳횴횵횶횷횸횺횼횽횾횿훀훁훂훃훆훇훉훊훋������훍훎훏훐훒훓훕훖훘훚훛훜훝훞훟훡훢훣훥훦훧훩훪훫훬훭������훮훯훱훲훳훴훶훷훸훹훺훻훾훿휁휂휃휅휆휇휈휉휊휋휌휍휎휏휐휒휓휔치칙친칟칠칡침칩칫칭카칵칸칼캄캅캇캉캐캑캔캘캠캡캣캤캥캬캭컁커컥컨컫컬컴컵컷컸컹케켁켄켈켐켑켓켕켜켠켤켬켭켯켰켱켸코콕콘콜콤콥콧콩콰콱콴콸쾀쾅쾌쾡쾨쾰쿄쿠쿡쿤쿨쿰쿱쿳쿵쿼퀀퀄퀑퀘퀭퀴퀵퀸퀼�".split("");
	for (j = 0; j != D[196].length; ++j) if (D[196][j].charCodeAt(0) !== 65533) {
		e[D[196][j]] = 50176 + j;
		d[50176 + j] = D[196][j];
	}
	D[197] = "�����������������������������������������������������������������휕휖휗휚휛휝휞휟휡휢휣휤휥휦휧휪휬휮휯휰휱휲휳휶휷휹������휺휻휽휾휿흀흁흂흃흅흆흈흊흋흌흍흎흏흒흓흕흚흛흜흝흞������흟흢흤흦흧흨흪흫흭흮흯흱흲흳흵흶흷흸흹흺흻흾흿힀힂힃힄힅힆힇힊힋큄큅큇큉큐큔큘큠크큭큰클큼큽킁키킥킨킬킴킵킷킹타탁탄탈탉탐탑탓탔탕태택탠탤탬탭탯탰탱탸턍터턱턴털턺텀텁텃텄텅테텍텐텔템텝텟텡텨텬텼톄톈토톡톤톨톰톱톳통톺톼퇀퇘퇴퇸툇툉툐투툭툰툴툼툽툿퉁퉈퉜�".split("");
	for (j = 0; j != D[197].length; ++j) if (D[197][j].charCodeAt(0) !== 65533) {
		e[D[197][j]] = 50432 + j;
		d[50432 + j] = D[197][j];
	}
	D[198] = "�����������������������������������������������������������������힍힎힏힑힒힓힔힕힖힗힚힜힞힟힠힡힢힣������������������������������������������������������������������������������퉤튀튁튄튈튐튑튕튜튠튤튬튱트특튼튿틀틂틈틉틋틔틘틜틤틥티틱틴틸팀팁팃팅파팍팎판팔팖팜팝팟팠팡팥패팩팬팰팸팹팻팼팽퍄퍅퍼퍽펀펄펌펍펏펐펑페펙펜펠펨펩펫펭펴편펼폄폅폈평폐폘폡폣포폭폰폴폼폽폿퐁�".split("");
	for (j = 0; j != D[198].length; ++j) if (D[198][j].charCodeAt(0) !== 65533) {
		e[D[198][j]] = 50688 + j;
		d[50688 + j] = D[198][j];
	}
	D[199] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������퐈퐝푀푄표푠푤푭푯푸푹푼푿풀풂품풉풋풍풔풩퓌퓐퓔퓜퓟퓨퓬퓰퓸퓻퓽프픈플픔픕픗피픽핀필핌핍핏핑하학한할핥함합핫항해핵핸핼햄햅햇했행햐향허헉헌헐헒험헙헛헝헤헥헨헬헴헵헷헹혀혁현혈혐협혓혔형혜혠�".split("");
	for (j = 0; j != D[199].length; ++j) if (D[199][j].charCodeAt(0) !== 65533) {
		e[D[199][j]] = 50944 + j;
		d[50944 + j] = D[199][j];
	}
	D[200] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������혤혭호혹혼홀홅홈홉홋홍홑화확환활홧황홰홱홴횃횅회획횐횔횝횟횡효횬횰횹횻후훅훈훌훑훔훗훙훠훤훨훰훵훼훽휀휄휑휘휙휜휠휨휩휫휭휴휵휸휼흄흇흉흐흑흔흖흗흘흙흠흡흣흥흩희흰흴흼흽힁히힉힌힐힘힙힛힝�".split("");
	for (j = 0; j != D[200].length; ++j) if (D[200][j].charCodeAt(0) !== 65533) {
		e[D[200][j]] = 51200 + j;
		d[51200 + j] = D[200][j];
	}
	D[202] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������伽佳假價加可呵哥嘉嫁家暇架枷柯歌珂痂稼苛茄街袈訶賈跏軻迦駕刻却各恪慤殼珏脚覺角閣侃刊墾奸姦干幹懇揀杆柬桿澗癎看磵稈竿簡肝艮艱諫間乫喝曷渴碣竭葛褐蝎鞨勘坎堪嵌感憾戡敢柑橄減甘疳監瞰紺邯鑑鑒龕�".split("");
	for (j = 0; j != D[202].length; ++j) if (D[202][j].charCodeAt(0) !== 65533) {
		e[D[202][j]] = 51712 + j;
		d[51712 + j] = D[202][j];
	}
	D[203] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������匣岬甲胛鉀閘剛堈姜岡崗康强彊慷江畺疆糠絳綱羌腔舡薑襁講鋼降鱇介价個凱塏愷愾慨改槪漑疥皆盖箇芥蓋豈鎧開喀客坑更粳羹醵倨去居巨拒据據擧渠炬祛距踞車遽鉅鋸乾件健巾建愆楗腱虔蹇鍵騫乞傑杰桀儉劍劒檢�".split("");
	for (j = 0; j != D[203].length; ++j) if (D[203][j].charCodeAt(0) !== 65533) {
		e[D[203][j]] = 51968 + j;
		d[51968 + j] = D[203][j];
	}
	D[204] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������瞼鈐黔劫怯迲偈憩揭擊格檄激膈覡隔堅牽犬甄絹繭肩見譴遣鵑抉決潔結缺訣兼慊箝謙鉗鎌京俓倞傾儆勁勍卿坰境庚徑慶憬擎敬景暻更梗涇炅烱璟璥瓊痙硬磬竟競絅經耕耿脛莖警輕逕鏡頃頸驚鯨係啓堺契季屆悸戒桂械�".split("");
	for (j = 0; j != D[204].length; ++j) if (D[204][j].charCodeAt(0) !== 65533) {
		e[D[204][j]] = 52224 + j;
		d[52224 + j] = D[204][j];
	}
	D[205] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������棨溪界癸磎稽系繫繼計誡谿階鷄古叩告呱固姑孤尻庫拷攷故敲暠枯槁沽痼皐睾稿羔考股膏苦苽菰藁蠱袴誥賈辜錮雇顧高鼓哭斛曲梏穀谷鵠困坤崑昆梱棍滾琨袞鯤汨滑骨供公共功孔工恐恭拱控攻珙空蚣貢鞏串寡戈果瓜�".split("");
	for (j = 0; j != D[205].length; ++j) if (D[205][j].charCodeAt(0) !== 65533) {
		e[D[205][j]] = 52480 + j;
		d[52480 + j] = D[205][j];
	}
	D[206] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������科菓誇課跨過鍋顆廓槨藿郭串冠官寬慣棺款灌琯瓘管罐菅觀貫關館刮恝括适侊光匡壙廣曠洸炚狂珖筐胱鑛卦掛罫乖傀塊壞怪愧拐槐魁宏紘肱轟交僑咬喬嬌嶠巧攪敎校橋狡皎矯絞翹膠蕎蛟較轎郊餃驕鮫丘久九仇俱具勾�".split("");
	for (j = 0; j != D[206].length; ++j) if (D[206][j].charCodeAt(0) !== 65533) {
		e[D[206][j]] = 52736 + j;
		d[52736 + j] = D[206][j];
	}
	D[207] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������區口句咎嘔坵垢寇嶇廐懼拘救枸柩構歐毆毬求溝灸狗玖球瞿矩究絿耉臼舅舊苟衢謳購軀逑邱鉤銶駒驅鳩鷗龜國局菊鞠鞫麴君窘群裙軍郡堀屈掘窟宮弓穹窮芎躬倦券勸卷圈拳捲權淃眷厥獗蕨蹶闕机櫃潰詭軌饋句晷歸貴�".split("");
	for (j = 0; j != D[207].length; ++j) if (D[207][j].charCodeAt(0) !== 65533) {
		e[D[207][j]] = 52992 + j;
		d[52992 + j] = D[207][j];
	}
	D[208] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������鬼龜叫圭奎揆槻珪硅窺竅糾葵規赳逵閨勻均畇筠菌鈞龜橘克剋劇戟棘極隙僅劤勤懃斤根槿瑾筋芹菫覲謹近饉契今妗擒昑檎琴禁禽芩衾衿襟金錦伋及急扱汲級給亘兢矜肯企伎其冀嗜器圻基埼夔奇妓寄岐崎己幾忌技旗旣�".split("");
	for (j = 0; j != D[208].length; ++j) if (D[208][j].charCodeAt(0) !== 65533) {
		e[D[208][j]] = 53248 + j;
		d[53248 + j] = D[208][j];
	}
	D[209] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������朞期杞棋棄機欺氣汽沂淇玘琦琪璂璣畸畿碁磯祁祇祈祺箕紀綺羈耆耭肌記譏豈起錡錤飢饑騎騏驥麒緊佶吉拮桔金喫儺喇奈娜懦懶拏拿癩羅蘿螺裸邏那樂洛烙珞落諾酪駱亂卵暖欄煖爛蘭難鸞捏捺南嵐枏楠湳濫男藍襤拉�".split("");
	for (j = 0; j != D[209].length; ++j) if (D[209][j].charCodeAt(0) !== 65533) {
		e[D[209][j]] = 53504 + j;
		d[53504 + j] = D[209][j];
	}
	D[210] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������納臘蠟衲囊娘廊朗浪狼郎乃來內奈柰耐冷女年撚秊念恬拈捻寧寗努勞奴弩怒擄櫓爐瑙盧老蘆虜路露駑魯鷺碌祿綠菉錄鹿論壟弄濃籠聾膿農惱牢磊腦賂雷尿壘屢樓淚漏累縷陋嫩訥杻紐勒肋凜凌稜綾能菱陵尼泥匿溺多茶�".split("");
	for (j = 0; j != D[210].length; ++j) if (D[210][j].charCodeAt(0) !== 65533) {
		e[D[210][j]] = 53760 + j;
		d[53760 + j] = D[210][j];
	}
	D[211] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������丹亶但單團壇彖斷旦檀段湍短端簞緞蛋袒鄲鍛撻澾獺疸達啖坍憺擔曇淡湛潭澹痰聃膽蕁覃談譚錟沓畓答踏遝唐堂塘幢戇撞棠當糖螳黨代垈坮大對岱帶待戴擡玳臺袋貸隊黛宅德悳倒刀到圖堵塗導屠島嶋度徒悼挑掉搗桃�".split("");
	for (j = 0; j != D[211].length; ++j) if (D[211][j].charCodeAt(0) !== 65533) {
		e[D[211][j]] = 54016 + j;
		d[54016 + j] = D[211][j];
	}
	D[212] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������棹櫂淘渡滔濤燾盜睹禱稻萄覩賭跳蹈逃途道都鍍陶韜毒瀆牘犢獨督禿篤纛讀墩惇敦旽暾沌焞燉豚頓乭突仝冬凍動同憧東桐棟洞潼疼瞳童胴董銅兜斗杜枓痘竇荳讀豆逗頭屯臀芚遁遯鈍得嶝橙燈登等藤謄鄧騰喇懶拏癩羅�".split("");
	for (j = 0; j != D[212].length; ++j) if (D[212][j].charCodeAt(0) !== 65533) {
		e[D[212][j]] = 54272 + j;
		d[54272 + j] = D[212][j];
	}
	D[213] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������蘿螺裸邏樂洛烙珞絡落諾酪駱丹亂卵欄欒瀾爛蘭鸞剌辣嵐擥攬欖濫籃纜藍襤覽拉臘蠟廊朗浪狼琅瑯螂郞來崍徠萊冷掠略亮倆兩凉梁樑粮粱糧良諒輛量侶儷勵呂廬慮戾旅櫚濾礪藜蠣閭驢驪麗黎力曆歷瀝礫轢靂憐戀攣漣�".split("");
	for (j = 0; j != D[213].length; ++j) if (D[213][j].charCodeAt(0) !== 65533) {
		e[D[213][j]] = 54528 + j;
		d[54528 + j] = D[213][j];
	}
	D[214] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������煉璉練聯蓮輦連鍊冽列劣洌烈裂廉斂殮濂簾獵令伶囹寧岺嶺怜玲笭羚翎聆逞鈴零靈領齡例澧禮醴隷勞怒撈擄櫓潞瀘爐盧老蘆虜路輅露魯鷺鹵碌祿綠菉錄鹿麓論壟弄朧瀧瓏籠聾儡瀨牢磊賂賚賴雷了僚寮廖料燎療瞭聊蓼�".split("");
	for (j = 0; j != D[214].length; ++j) if (D[214][j].charCodeAt(0) !== 65533) {
		e[D[214][j]] = 54784 + j;
		d[54784 + j] = D[214][j];
	}
	D[215] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������遼鬧龍壘婁屢樓淚漏瘻累縷蔞褸鏤陋劉旒柳榴流溜瀏琉瑠留瘤硫謬類六戮陸侖倫崙淪綸輪律慄栗率隆勒肋凜凌楞稜綾菱陵俚利厘吏唎履悧李梨浬犁狸理璃異痢籬罹羸莉裏裡里釐離鯉吝潾燐璘藺躪隣鱗麟林淋琳臨霖砬�".split("");
	for (j = 0; j != D[215].length; ++j) if (D[215][j].charCodeAt(0) !== 65533) {
		e[D[215][j]] = 55040 + j;
		d[55040 + j] = D[215][j];
	}
	D[216] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������立笠粒摩瑪痲碼磨馬魔麻寞幕漠膜莫邈万卍娩巒彎慢挽晩曼滿漫灣瞞萬蔓蠻輓饅鰻唜抹末沫茉襪靺亡妄忘忙望網罔芒茫莽輞邙埋妹媒寐昧枚梅每煤罵買賣邁魅脈貊陌驀麥孟氓猛盲盟萌冪覓免冕勉棉沔眄眠綿緬面麵滅�".split("");
	for (j = 0; j != D[216].length; ++j) if (D[216][j].charCodeAt(0) !== 65533) {
		e[D[216][j]] = 55296 + j;
		d[55296 + j] = D[216][j];
	}
	D[217] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������蔑冥名命明暝椧溟皿瞑茗蓂螟酩銘鳴袂侮冒募姆帽慕摸摹暮某模母毛牟牡瑁眸矛耗芼茅謀謨貌木沐牧目睦穆鶩歿沒夢朦蒙卯墓妙廟描昴杳渺猫竗苗錨務巫憮懋戊拇撫无楙武毋無珷畝繆舞茂蕪誣貿霧鵡墨默們刎吻問文�".split("");
	for (j = 0; j != D[217].length; ++j) if (D[217][j].charCodeAt(0) !== 65533) {
		e[D[217][j]] = 55552 + j;
		d[55552 + j] = D[217][j];
	}
	D[218] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������汶紊紋聞蚊門雯勿沕物味媚尾嵋彌微未梶楣渼湄眉米美薇謎迷靡黴岷悶愍憫敏旻旼民泯玟珉緡閔密蜜謐剝博拍搏撲朴樸泊珀璞箔粕縛膊舶薄迫雹駁伴半反叛拌搬攀斑槃泮潘班畔瘢盤盼磐磻礬絆般蟠返頒飯勃拔撥渤潑�".split("");
	for (j = 0; j != D[218].length; ++j) if (D[218][j].charCodeAt(0) !== 65533) {
		e[D[218][j]] = 55808 + j;
		d[55808 + j] = D[218][j];
	}
	D[219] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������發跋醱鉢髮魃倣傍坊妨尨幇彷房放方旁昉枋榜滂磅紡肪膀舫芳蒡蚌訪謗邦防龐倍俳北培徘拜排杯湃焙盃背胚裴裵褙賠輩配陪伯佰帛柏栢白百魄幡樊煩燔番磻繁蕃藩飜伐筏罰閥凡帆梵氾汎泛犯範范法琺僻劈壁擘檗璧癖�".split("");
	for (j = 0; j != D[219].length; ++j) if (D[219][j].charCodeAt(0) !== 65533) {
		e[D[219][j]] = 56064 + j;
		d[56064 + j] = D[219][j];
	}
	D[220] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������碧蘗闢霹便卞弁變辨辯邊別瞥鱉鼈丙倂兵屛幷昞昺柄棅炳甁病秉竝輧餠騈保堡報寶普步洑湺潽珤甫菩補褓譜輔伏僕匐卜宓復服福腹茯蔔複覆輹輻馥鰒本乶俸奉封峯峰捧棒烽熢琫縫蓬蜂逢鋒鳳不付俯傅剖副否咐埠夫婦�".split("");
	for (j = 0; j != D[220].length; ++j) if (D[220][j].charCodeAt(0) !== 65533) {
		e[D[220][j]] = 56320 + j;
		d[56320 + j] = D[220][j];
	}
	D[221] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������孚孵富府復扶敷斧浮溥父符簿缶腐腑膚艀芙莩訃負賦賻赴趺部釜阜附駙鳧北分吩噴墳奔奮忿憤扮昐汾焚盆粉糞紛芬賁雰不佛弗彿拂崩朋棚硼繃鵬丕備匕匪卑妃婢庇悲憊扉批斐枇榧比毖毗毘沸泌琵痺砒碑秕秘粃緋翡肥�".split("");
	for (j = 0; j != D[221].length; ++j) if (D[221][j].charCodeAt(0) !== 65533) {
		e[D[221][j]] = 56576 + j;
		d[56576 + j] = D[221][j];
	}
	D[222] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������脾臂菲蜚裨誹譬費鄙非飛鼻嚬嬪彬斌檳殯浜濱瀕牝玭貧賓頻憑氷聘騁乍事些仕伺似使俟僿史司唆嗣四士奢娑寫寺射巳師徙思捨斜斯柶査梭死沙泗渣瀉獅砂社祀祠私篩紗絲肆舍莎蓑蛇裟詐詞謝賜赦辭邪飼駟麝削數朔索�".split("");
	for (j = 0; j != D[222].length; ++j) if (D[222][j].charCodeAt(0) !== 65533) {
		e[D[222][j]] = 56832 + j;
		d[56832 + j] = D[222][j];
	}
	D[223] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������傘刪山散汕珊産疝算蒜酸霰乷撒殺煞薩三參杉森渗芟蔘衫揷澁鈒颯上傷像償商喪嘗孀尙峠常床庠廂想桑橡湘爽牀狀相祥箱翔裳觴詳象賞霜塞璽賽嗇塞穡索色牲生甥省笙墅壻嶼序庶徐恕抒捿敍暑曙書栖棲犀瑞筮絮緖署�".split("");
	for (j = 0; j != D[223].length; ++j) if (D[223][j].charCodeAt(0) !== 65533) {
		e[D[223][j]] = 57088 + j;
		d[57088 + j] = D[223][j];
	}
	D[224] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������胥舒薯西誓逝鋤黍鼠夕奭席惜昔晳析汐淅潟石碩蓆釋錫仙僊先善嬋宣扇敾旋渲煽琁瑄璇璿癬禪線繕羨腺膳船蘚蟬詵跣選銑鐥饍鮮卨屑楔泄洩渫舌薛褻設說雪齧剡暹殲纖蟾贍閃陝攝涉燮葉城姓宬性惺成星晟猩珹盛省筬�".split("");
	for (j = 0; j != D[224].length; ++j) if (D[224][j].charCodeAt(0) !== 65533) {
		e[D[224][j]] = 57344 + j;
		d[57344 + j] = D[224][j];
	}
	D[225] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������聖聲腥誠醒世勢歲洗稅笹細說貰召嘯塑宵小少巢所掃搔昭梳沼消溯瀟炤燒甦疏疎瘙笑篠簫素紹蔬蕭蘇訴逍遡邵銷韶騷俗屬束涑粟續謖贖速孫巽損蓀遜飡率宋悚松淞訟誦送頌刷殺灑碎鎖衰釗修受嗽囚垂壽嫂守岫峀帥愁�".split("");
	for (j = 0; j != D[225].length; ++j) if (D[225][j].charCodeAt(0) !== 65533) {
		e[D[225][j]] = 57600 + j;
		d[57600 + j] = D[225][j];
	}
	D[226] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������戍手授搜收數樹殊水洙漱燧狩獸琇璲瘦睡秀穗竪粹綏綬繡羞脩茱蒐蓚藪袖誰讐輸遂邃酬銖銹隋隧隨雖需須首髓鬚叔塾夙孰宿淑潚熟琡璹肅菽巡徇循恂旬栒楯橓殉洵淳珣盾瞬筍純脣舜荀蓴蕣詢諄醇錞順馴戌術述鉥崇崧�".split("");
	for (j = 0; j != D[226].length; ++j) if (D[226][j].charCodeAt(0) !== 65533) {
		e[D[226][j]] = 57856 + j;
		d[57856 + j] = D[226][j];
	}
	D[227] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������嵩瑟膝蝨濕拾習褶襲丞乘僧勝升承昇繩蠅陞侍匙嘶始媤尸屎屍市弑恃施是時枾柴猜矢示翅蒔蓍視試詩諡豕豺埴寔式息拭植殖湜熄篒蝕識軾食飾伸侁信呻娠宸愼新晨燼申神紳腎臣莘薪藎蜃訊身辛辰迅失室實悉審尋心沁�".split("");
	for (j = 0; j != D[227].length; ++j) if (D[227][j].charCodeAt(0) !== 65533) {
		e[D[227][j]] = 58112 + j;
		d[58112 + j] = D[227][j];
	}
	D[228] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������沈深瀋甚芯諶什十拾雙氏亞俄兒啞娥峨我牙芽莪蛾衙訝阿雅餓鴉鵝堊岳嶽幄惡愕握樂渥鄂鍔顎鰐齷安岸按晏案眼雁鞍顔鮟斡謁軋閼唵岩巖庵暗癌菴闇壓押狎鴨仰央怏昻殃秧鴦厓哀埃崖愛曖涯碍艾隘靄厄扼掖液縊腋額�".split("");
	for (j = 0; j != D[228].length; ++j) if (D[228][j].charCodeAt(0) !== 65533) {
		e[D[228][j]] = 58368 + j;
		d[58368 + j] = D[228][j];
	}
	D[229] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������櫻罌鶯鸚也倻冶夜惹揶椰爺耶若野弱掠略約若葯蒻藥躍亮佯兩凉壤孃恙揚攘敭暘梁楊樣洋瀁煬痒瘍禳穰糧羊良襄諒讓釀陽量養圄御於漁瘀禦語馭魚齬億憶抑檍臆偃堰彦焉言諺孼蘖俺儼嚴奄掩淹嶪業円予余勵呂女如廬�".split("");
	for (j = 0; j != D[229].length; ++j) if (D[229][j].charCodeAt(0) !== 65533) {
		e[D[229][j]] = 58624 + j;
		d[58624 + j] = D[229][j];
	}
	D[230] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������旅歟汝濾璵礖礪與艅茹輿轝閭餘驪麗黎亦力域役易曆歷疫繹譯轢逆驛嚥堧姸娟宴年延憐戀捐挻撚椽沇沿涎涓淵演漣烟然煙煉燃燕璉硏硯秊筵緣練縯聯衍軟輦蓮連鉛鍊鳶列劣咽悅涅烈熱裂說閱厭廉念捻染殮炎焰琰艶苒�".split("");
	for (j = 0; j != D[230].length; ++j) if (D[230][j].charCodeAt(0) !== 65533) {
		e[D[230][j]] = 58880 + j;
		d[58880 + j] = D[230][j];
	}
	D[231] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������簾閻髥鹽曄獵燁葉令囹塋寧嶺嶸影怜映暎楹榮永泳渶潁濚瀛瀯煐營獰玲瑛瑩瓔盈穎纓羚聆英詠迎鈴鍈零霙靈領乂倪例刈叡曳汭濊猊睿穢芮藝蘂禮裔詣譽豫醴銳隸霓預五伍俉傲午吾吳嗚塢墺奧娛寤悟惡懊敖旿晤梧汚澳�".split("");
	for (j = 0; j != D[231].length; ++j) if (D[231][j].charCodeAt(0) !== 65533) {
		e[D[231][j]] = 59136 + j;
		d[59136 + j] = D[231][j];
	}
	D[232] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������烏熬獒筽蜈誤鰲鼇屋沃獄玉鈺溫瑥瘟穩縕蘊兀壅擁瓮甕癰翁邕雍饔渦瓦窩窪臥蛙蝸訛婉完宛梡椀浣玩琓琬碗緩翫脘腕莞豌阮頑曰往旺枉汪王倭娃歪矮外嵬巍猥畏了僚僥凹堯夭妖姚寥寮尿嶢拗搖撓擾料曜樂橈燎燿瑤療�".split("");
	for (j = 0; j != D[232].length; ++j) if (D[232][j].charCodeAt(0) !== 65533) {
		e[D[232][j]] = 59392 + j;
		d[59392 + j] = D[232][j];
	}
	D[233] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������窈窯繇繞耀腰蓼蟯要謠遙遼邀饒慾欲浴縟褥辱俑傭冗勇埇墉容庸慂榕涌湧溶熔瑢用甬聳茸蓉踊鎔鏞龍于佑偶優又友右宇寓尤愚憂旴牛玗瑀盂祐禑禹紆羽芋藕虞迂遇郵釪隅雨雩勖彧旭昱栯煜稶郁頊云暈橒殞澐熉耘芸蕓�".split("");
	for (j = 0; j != D[233].length; ++j) if (D[233][j].charCodeAt(0) !== 65533) {
		e[D[233][j]] = 59648 + j;
		d[59648 + j] = D[233][j];
	}
	D[234] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������運隕雲韻蔚鬱亐熊雄元原員圓園垣媛嫄寃怨愿援沅洹湲源爰猿瑗苑袁轅遠阮院願鴛月越鉞位偉僞危圍委威尉慰暐渭爲瑋緯胃萎葦蔿蝟衛褘謂違韋魏乳侑儒兪劉唯喩孺宥幼幽庾悠惟愈愉揄攸有杻柔柚柳楡楢油洧流游溜�".split("");
	for (j = 0; j != D[234].length; ++j) if (D[234][j].charCodeAt(0) !== 65533) {
		e[D[234][j]] = 59904 + j;
		d[59904 + j] = D[234][j];
	}
	D[235] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������濡猶猷琉瑜由留癒硫紐維臾萸裕誘諛諭踰蹂遊逾遺酉釉鍮類六堉戮毓肉育陸倫允奫尹崙淪潤玧胤贇輪鈗閏律慄栗率聿戎瀜絨融隆垠恩慇殷誾銀隱乙吟淫蔭陰音飮揖泣邑凝應膺鷹依倚儀宜意懿擬椅毅疑矣義艤薏蟻衣誼�".split("");
	for (j = 0; j != D[235].length; ++j) if (D[235][j].charCodeAt(0) !== 65533) {
		e[D[235][j]] = 60160 + j;
		d[60160 + j] = D[235][j];
	}
	D[236] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������議醫二以伊利吏夷姨履已弛彛怡易李梨泥爾珥理異痍痢移罹而耳肄苡荑裏裡貽貳邇里離飴餌匿溺瀷益翊翌翼謚人仁刃印吝咽因姻寅引忍湮燐璘絪茵藺蚓認隣靭靷鱗麟一佚佾壹日溢逸鎰馹任壬妊姙恁林淋稔臨荏賃入卄�".split("");
	for (j = 0; j != D[236].length; ++j) if (D[236][j].charCodeAt(0) !== 65533) {
		e[D[236][j]] = 60416 + j;
		d[60416 + j] = D[236][j];
	}
	D[237] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������立笠粒仍剩孕芿仔刺咨姉姿子字孜恣慈滋炙煮玆瓷疵磁紫者自茨蔗藉諮資雌作勺嚼斫昨灼炸爵綽芍酌雀鵲孱棧殘潺盞岑暫潛箴簪蠶雜丈仗匠場墻壯奬將帳庄張掌暲杖樟檣欌漿牆狀獐璋章粧腸臟臧莊葬蔣薔藏裝贓醬長�".split("");
	for (j = 0; j != D[237].length; ++j) if (D[237][j].charCodeAt(0) !== 65533) {
		e[D[237][j]] = 60672 + j;
		d[60672 + j] = D[237][j];
	}
	D[238] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������障再哉在宰才材栽梓渽滓災縡裁財載齋齎爭箏諍錚佇低儲咀姐底抵杵楮樗沮渚狙猪疽箸紵苧菹著藷詛貯躇這邸雎齟勣吊嫡寂摘敵滴狄炙的積笛籍績翟荻謫賊赤跡蹟迪迹適鏑佃佺傳全典前剪塡塼奠專展廛悛戰栓殿氈澱�".split("");
	for (j = 0; j != D[238].length; ++j) if (D[238][j].charCodeAt(0) !== 65533) {
		e[D[238][j]] = 60928 + j;
		d[60928 + j] = D[238][j];
	}
	D[239] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������煎琠田甸畑癲筌箋箭篆纏詮輾轉鈿銓錢鐫電顚顫餞切截折浙癤竊節絶占岾店漸点粘霑鮎點接摺蝶丁井亭停偵呈姃定幀庭廷征情挺政整旌晶晸柾楨檉正汀淀淨渟湞瀞炡玎珽町睛碇禎程穽精綎艇訂諪貞鄭酊釘鉦鋌錠霆靖�".split("");
	for (j = 0; j != D[239].length; ++j) if (D[239][j].charCodeAt(0) !== 65533) {
		e[D[239][j]] = 61184 + j;
		d[61184 + j] = D[239][j];
	}
	D[240] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������靜頂鼎制劑啼堤帝弟悌提梯濟祭第臍薺製諸蹄醍除際霽題齊俎兆凋助嘲弔彫措操早晁曺曹朝條棗槽漕潮照燥爪璪眺祖祚租稠窕粗糟組繰肇藻蚤詔調趙躁造遭釣阻雕鳥族簇足鏃存尊卒拙猝倧宗從悰慫棕淙琮種終綜縱腫�".split("");
	for (j = 0; j != D[240].length; ++j) if (D[240][j].charCodeAt(0) !== 65533) {
		e[D[240][j]] = 61440 + j;
		d[61440 + j] = D[240][j];
	}
	D[241] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������踪踵鍾鐘佐坐左座挫罪主住侏做姝胄呪周嗾奏宙州廚晝朱柱株注洲湊澍炷珠疇籌紂紬綢舟蛛註誅走躊輳週酎酒鑄駐竹粥俊儁准埈寯峻晙樽浚準濬焌畯竣蠢逡遵雋駿茁中仲衆重卽櫛楫汁葺增憎曾拯烝甑症繒蒸證贈之只�".split("");
	for (j = 0; j != D[241].length; ++j) if (D[241][j].charCodeAt(0) !== 65533) {
		e[D[241][j]] = 61696 + j;
		d[61696 + j] = D[241][j];
	}
	D[242] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������咫地址志持指摯支旨智枝枳止池沚漬知砥祉祗紙肢脂至芝芷蜘誌識贄趾遲直稙稷織職唇嗔塵振搢晉晋桭榛殄津溱珍瑨璡畛疹盡眞瞋秦縉縝臻蔯袗診賑軫辰進鎭陣陳震侄叱姪嫉帙桎瓆疾秩窒膣蛭質跌迭斟朕什執潗緝輯�".split("");
	for (j = 0; j != D[242].length; ++j) if (D[242][j].charCodeAt(0) !== 65533) {
		e[D[242][j]] = 61952 + j;
		d[61952 + j] = D[242][j];
	}
	D[243] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������鏶集徵懲澄且侘借叉嗟嵯差次此磋箚茶蹉車遮捉搾着窄錯鑿齪撰澯燦璨瓚竄簒纂粲纘讚贊鑽餐饌刹察擦札紮僭參塹慘慙懺斬站讒讖倉倡創唱娼廠彰愴敞昌昶暢槍滄漲猖瘡窓脹艙菖蒼債埰寀寨彩採砦綵菜蔡采釵冊柵策�".split("");
	for (j = 0; j != D[243].length; ++j) if (D[243][j].charCodeAt(0) !== 65533) {
		e[D[243][j]] = 62208 + j;
		d[62208 + j] = D[243][j];
	}
	D[244] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������責凄妻悽處倜刺剔尺慽戚拓擲斥滌瘠脊蹠陟隻仟千喘天川擅泉淺玔穿舛薦賤踐遷釧闡阡韆凸哲喆徹撤澈綴輟轍鐵僉尖沾添甛瞻簽籤詹諂堞妾帖捷牒疊睫諜貼輒廳晴淸聽菁請靑鯖切剃替涕滯締諦逮遞體初剿哨憔抄招梢�".split("");
	for (j = 0; j != D[244].length; ++j) if (D[244][j].charCodeAt(0) !== 65533) {
		e[D[244][j]] = 62464 + j;
		d[62464 + j] = D[244][j];
	}
	D[245] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������椒楚樵炒焦硝礁礎秒稍肖艸苕草蕉貂超酢醋醮促囑燭矗蜀觸寸忖村邨叢塚寵悤憁摠總聰蔥銃撮催崔最墜抽推椎楸樞湫皺秋芻萩諏趨追鄒酋醜錐錘鎚雛騶鰍丑畜祝竺筑築縮蓄蹙蹴軸逐春椿瑃出朮黜充忠沖蟲衝衷悴膵萃�".split("");
	for (j = 0; j != D[245].length; ++j) if (D[245][j].charCodeAt(0) !== 65533) {
		e[D[245][j]] = 62720 + j;
		d[62720 + j] = D[245][j];
	}
	D[246] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������贅取吹嘴娶就炊翠聚脆臭趣醉驟鷲側仄厠惻測層侈値嗤峙幟恥梔治淄熾痔痴癡稚穉緇緻置致蚩輜雉馳齒則勅飭親七柒漆侵寢枕沈浸琛砧針鍼蟄秤稱快他咤唾墮妥惰打拖朶楕舵陀馱駝倬卓啄坼度托拓擢晫柝濁濯琢琸託�".split("");
	for (j = 0; j != D[246].length; ++j) if (D[246][j].charCodeAt(0) !== 65533) {
		e[D[246][j]] = 62976 + j;
		d[62976 + j] = D[246][j];
	}
	D[247] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������鐸呑嘆坦彈憚歎灘炭綻誕奪脫探眈耽貪塔搭榻宕帑湯糖蕩兌台太怠態殆汰泰笞胎苔跆邰颱宅擇澤撑攄兎吐土討慟桶洞痛筒統通堆槌腿褪退頹偸套妬投透鬪慝特闖坡婆巴把播擺杷波派爬琶破罷芭跛頗判坂板版瓣販辦鈑�".split("");
	for (j = 0; j != D[247].length; ++j) if (D[247][j].charCodeAt(0) !== 65533) {
		e[D[247][j]] = 63232 + j;
		d[63232 + j] = D[247][j];
	}
	D[248] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������阪八叭捌佩唄悖敗沛浿牌狽稗覇貝彭澎烹膨愎便偏扁片篇編翩遍鞭騙貶坪平枰萍評吠嬖幣廢弊斃肺蔽閉陛佈包匍匏咆哺圃布怖抛抱捕暴泡浦疱砲胞脯苞葡蒲袍褒逋鋪飽鮑幅暴曝瀑爆輻俵剽彪慓杓標漂瓢票表豹飇飄驃�".split("");
	for (j = 0; j != D[248].length; ++j) if (D[248][j].charCodeAt(0) !== 65533) {
		e[D[248][j]] = 63488 + j;
		d[63488 + j] = D[248][j];
	}
	D[249] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������品稟楓諷豊風馮彼披疲皮被避陂匹弼必泌珌畢疋筆苾馝乏逼下何厦夏廈昰河瑕荷蝦賀遐霞鰕壑學虐謔鶴寒恨悍旱汗漢澣瀚罕翰閑閒限韓割轄函含咸啣喊檻涵緘艦銜陷鹹合哈盒蛤閤闔陜亢伉姮嫦巷恒抗杭桁沆港缸肛航�".split("");
	for (j = 0; j != D[249].length; ++j) if (D[249][j].charCodeAt(0) !== 65533) {
		e[D[249][j]] = 63744 + j;
		d[63744 + j] = D[249][j];
	}
	D[250] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������行降項亥偕咳垓奚孩害懈楷海瀣蟹解該諧邂駭骸劾核倖幸杏荇行享向嚮珦鄕響餉饗香噓墟虛許憲櫶獻軒歇險驗奕爀赫革俔峴弦懸晛泫炫玄玹現眩睍絃絢縣舷衒見賢鉉顯孑穴血頁嫌俠協夾峽挾浹狹脅脇莢鋏頰亨兄刑型�".split("");
	for (j = 0; j != D[250].length; ++j) if (D[250][j].charCodeAt(0) !== 65533) {
		e[D[250][j]] = 64e3 + j;
		d[64e3 + j] = D[250][j];
	}
	D[251] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������形泂滎瀅灐炯熒珩瑩荊螢衡逈邢鎣馨兮彗惠慧暳蕙蹊醯鞋乎互呼壕壺好岵弧戶扈昊晧毫浩淏湖滸澔濠濩灝狐琥瑚瓠皓祜糊縞胡芦葫蒿虎號蝴護豪鎬頀顥惑或酷婚昏混渾琿魂忽惚笏哄弘汞泓洪烘紅虹訌鴻化和嬅樺火畵�".split("");
	for (j = 0; j != D[251].length; ++j) if (D[251][j].charCodeAt(0) !== 65533) {
		e[D[251][j]] = 64256 + j;
		d[64256 + j] = D[251][j];
	}
	D[252] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������禍禾花華話譁貨靴廓擴攫確碻穫丸喚奐宦幻患換歡晥桓渙煥環紈還驩鰥活滑猾豁闊凰幌徨恍惶愰慌晃晄榥況湟滉潢煌璜皇篁簧荒蝗遑隍黃匯回廻徊恢悔懷晦會檜淮澮灰獪繪膾茴蛔誨賄劃獲宖橫鐄哮嚆孝效斅曉梟涍淆�".split("");
	for (j = 0; j != D[252].length; ++j) if (D[252][j].charCodeAt(0) !== 65533) {
		e[D[252][j]] = 64512 + j;
		d[64512 + j] = D[252][j];
	}
	D[253] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������爻肴酵驍侯候厚后吼喉嗅帿後朽煦珝逅勛勳塤壎焄熏燻薰訓暈薨喧暄煊萱卉喙毁彙徽揮暉煇諱輝麾休携烋畦虧恤譎鷸兇凶匈洶胸黑昕欣炘痕吃屹紇訖欠欽歆吸恰洽翕興僖凞喜噫囍姬嬉希憙憘戱晞曦熙熹熺犧禧稀羲詰�".split("");
	for (j = 0; j != D[253].length; ++j) if (D[253][j].charCodeAt(0) !== 65533) {
		e[D[253][j]] = 64768 + j;
		d[64768 + j] = D[253][j];
	}
	return {
		"enc": e,
		"dec": d
	};
})();
cptable[950] = (function() {
	var d = [], e = {}, D = [], j;
	D[0] = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~��������������������������������������������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[0].length; ++j) if (D[0][j].charCodeAt(0) !== 65533) {
		e[D[0][j]] = 0 + j;
		d[0 + j] = D[0][j];
	}
	D[161] = "����������������������������������������������������������������　，、。．‧；：？！︰…‥﹐﹑﹒·﹔﹕﹖﹗｜–︱—︳╴︴﹏（）︵︶｛｝︷︸〔〕︹︺【】︻︼《》︽︾〈〉︿﹀「」﹁﹂『』﹃﹄﹙﹚����������������������������������﹛﹜﹝﹞‘’“”〝〞‵′＃＆＊※§〃○●△▲◎☆★◇◆□■▽▼㊣℅¯￣＿ˍ﹉﹊﹍﹎﹋﹌﹟﹠﹡＋－×÷±√＜＞＝≦≧≠∞≒≡﹢﹣﹤﹥﹦～∩∪⊥∠∟⊿㏒㏑∫∮∵∴♀♂⊕⊙↑↓←→↖↗↙↘∥∣／�".split("");
	for (j = 0; j != D[161].length; ++j) if (D[161][j].charCodeAt(0) !== 65533) {
		e[D[161][j]] = 41216 + j;
		d[41216 + j] = D[161][j];
	}
	D[162] = "����������������������������������������������������������������＼∕﹨＄￥〒￠￡％＠℃℉﹩﹪﹫㏕㎜㎝㎞㏎㎡㎎㎏㏄°兙兛兞兝兡兣嗧瓩糎▁▂▃▄▅▆▇█▏▎▍▌▋▊▉┼┴┬┤├▔─│▕┌┐└┘╭����������������������������������╮╰╯═╞╪╡◢◣◥◤╱╲╳０１２３４５６７８９ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ〡〢〣〤〥〦〧〨〩十卄卅ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖ�".split("");
	for (j = 0; j != D[162].length; ++j) if (D[162][j].charCodeAt(0) !== 65533) {
		e[D[162][j]] = 41472 + j;
		d[41472 + j] = D[162][j];
	}
	D[163] = "����������������������������������������������������������������ｗｘｙｚΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψωㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏ����������������������������������ㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ˙ˉˊˇˋ���������������������������������€������������������������������".split("");
	for (j = 0; j != D[163].length; ++j) if (D[163][j].charCodeAt(0) !== 65533) {
		e[D[163][j]] = 41728 + j;
		d[41728 + j] = D[163][j];
	}
	D[164] = "����������������������������������������������������������������一乙丁七乃九了二人儿入八几刀刁力匕十卜又三下丈上丫丸凡久么也乞于亡兀刃勺千叉口土士夕大女子孑孓寸小尢尸山川工己已巳巾干廾弋弓才����������������������������������丑丐不中丰丹之尹予云井互五亢仁什仃仆仇仍今介仄元允內六兮公冗凶分切刈勻勾勿化匹午升卅卞厄友及反壬天夫太夭孔少尤尺屯巴幻廿弔引心戈戶手扎支文斗斤方日曰月木欠止歹毋比毛氏水火爪父爻片牙牛犬王丙�".split("");
	for (j = 0; j != D[164].length; ++j) if (D[164][j].charCodeAt(0) !== 65533) {
		e[D[164][j]] = 41984 + j;
		d[41984 + j] = D[164][j];
	}
	D[165] = "����������������������������������������������������������������世丕且丘主乍乏乎以付仔仕他仗代令仙仞充兄冉冊冬凹出凸刊加功包匆北匝仟半卉卡占卯卮去可古右召叮叩叨叼司叵叫另只史叱台句叭叻四囚外����������������������������������央失奴奶孕它尼巨巧左市布平幼弁弘弗必戊打扔扒扑斥旦朮本未末札正母民氐永汁汀氾犯玄玉瓜瓦甘生用甩田由甲申疋白皮皿目矛矢石示禾穴立丞丟乒乓乩亙交亦亥仿伉伙伊伕伍伐休伏仲件任仰仳份企伋光兇兆先全�".split("");
	for (j = 0; j != D[165].length; ++j) if (D[165][j].charCodeAt(0) !== 65533) {
		e[D[165][j]] = 42240 + j;
		d[42240 + j] = D[165][j];
	}
	D[166] = "����������������������������������������������������������������共再冰列刑划刎刖劣匈匡匠印危吉吏同吊吐吁吋各向名合吃后吆吒因回囝圳地在圭圬圯圩夙多夷夸妄奸妃好她如妁字存宇守宅安寺尖屹州帆并年����������������������������������式弛忙忖戎戌戍成扣扛托收早旨旬旭曲曳有朽朴朱朵次此死氖汝汗汙江池汐汕污汛汍汎灰牟牝百竹米糸缶羊羽老考而耒耳聿肉肋肌臣自至臼舌舛舟艮色艾虫血行衣西阡串亨位住佇佗佞伴佛何估佐佑伽伺伸佃佔似但佣�".split("");
	for (j = 0; j != D[166].length; ++j) if (D[166][j].charCodeAt(0) !== 65533) {
		e[D[166][j]] = 42496 + j;
		d[42496 + j] = D[166][j];
	}
	D[167] = "����������������������������������������������������������������作你伯低伶余佝佈佚兌克免兵冶冷別判利刪刨劫助努劬匣即卵吝吭吞吾否呎吧呆呃吳呈呂君吩告吹吻吸吮吵吶吠吼呀吱含吟听囪困囤囫坊坑址坍����������������������������������均坎圾坐坏圻壯夾妝妒妨妞妣妙妖妍妤妓妊妥孝孜孚孛完宋宏尬局屁尿尾岐岑岔岌巫希序庇床廷弄弟彤形彷役忘忌志忍忱快忸忪戒我抄抗抖技扶抉扭把扼找批扳抒扯折扮投抓抑抆改攻攸旱更束李杏材村杜杖杞杉杆杠�".split("");
	for (j = 0; j != D[167].length; ++j) if (D[167][j].charCodeAt(0) !== 65533) {
		e[D[167][j]] = 42752 + j;
		d[42752 + j] = D[167][j];
	}
	D[168] = "����������������������������������������������������������������杓杗步每求汞沙沁沈沉沅沛汪決沐汰沌汨沖沒汽沃汲汾汴沆汶沍沔沘沂灶灼災灸牢牡牠狄狂玖甬甫男甸皂盯矣私秀禿究系罕肖肓肝肘肛肚育良芒����������������������������������芋芍見角言谷豆豕貝赤走足身車辛辰迂迆迅迄巡邑邢邪邦那酉釆里防阮阱阪阬並乖乳事些亞享京佯依侍佳使佬供例來侃佰併侈佩佻侖佾侏侑佺兔兒兕兩具其典冽函刻券刷刺到刮制剁劾劻卒協卓卑卦卷卸卹取叔受味呵�".split("");
	for (j = 0; j != D[168].length; ++j) if (D[168][j].charCodeAt(0) !== 65533) {
		e[D[168][j]] = 43008 + j;
		d[43008 + j] = D[168][j];
	}
	D[169] = "����������������������������������������������������������������咖呸咕咀呻呷咄咒咆呼咐呱呶和咚呢周咋命咎固垃坷坪坩坡坦坤坼夜奉奇奈奄奔妾妻委妹妮姑姆姐姍始姓姊妯妳姒姅孟孤季宗定官宜宙宛尚屈居����������������������������������屆岷岡岸岩岫岱岳帘帚帖帕帛帑幸庚店府底庖延弦弧弩往征彿彼忝忠忽念忿怏怔怯怵怖怪怕怡性怩怫怛或戕房戾所承拉拌拄抿拂抹拒招披拓拔拋拈抨抽押拐拙拇拍抵拚抱拘拖拗拆抬拎放斧於旺昔易昌昆昂明昀昏昕昊�".split("");
	for (j = 0; j != D[169].length; ++j) if (D[169][j].charCodeAt(0) !== 65533) {
		e[D[169][j]] = 43264 + j;
		d[43264 + j] = D[169][j];
	}
	D[170] = "����������������������������������������������������������������昇服朋杭枋枕東果杳杷枇枝林杯杰板枉松析杵枚枓杼杪杲欣武歧歿氓氛泣注泳沱泌泥河沽沾沼波沫法泓沸泄油況沮泗泅泱沿治泡泛泊沬泯泜泖泠����������������������������������炕炎炒炊炙爬爭爸版牧物狀狎狙狗狐玩玨玟玫玥甽疝疙疚的盂盲直知矽社祀祁秉秈空穹竺糾罔羌羋者肺肥肢肱股肫肩肴肪肯臥臾舍芳芝芙芭芽芟芹花芬芥芯芸芣芰芾芷虎虱初表軋迎返近邵邸邱邶采金長門阜陀阿阻附�".split("");
	for (j = 0; j != D[170].length; ++j) if (D[170][j].charCodeAt(0) !== 65533) {
		e[D[170][j]] = 43520 + j;
		d[43520 + j] = D[170][j];
	}
	D[171] = "����������������������������������������������������������������陂隹雨青非亟亭亮信侵侯便俠俑俏保促侶俘俟俊俗侮俐俄係俚俎俞侷兗冒冑冠剎剃削前剌剋則勇勉勃勁匍南卻厚叛咬哀咨哎哉咸咦咳哇哂咽咪品����������������������������������哄哈咯咫咱咻咩咧咿囿垂型垠垣垢城垮垓奕契奏奎奐姜姘姿姣姨娃姥姪姚姦威姻孩宣宦室客宥封屎屏屍屋峙峒巷帝帥帟幽庠度建弈弭彥很待徊律徇後徉怒思怠急怎怨恍恰恨恢恆恃恬恫恪恤扁拜挖按拼拭持拮拽指拱拷�".split("");
	for (j = 0; j != D[171].length; ++j) if (D[171][j].charCodeAt(0) !== 65533) {
		e[D[171][j]] = 43776 + j;
		d[43776 + j] = D[171][j];
	}
	D[172] = "����������������������������������������������������������������拯括拾拴挑挂政故斫施既春昭映昧是星昨昱昤曷柿染柱柔某柬架枯柵柩柯柄柑枴柚查枸柏柞柳枰柙柢柝柒歪殃殆段毒毗氟泉洋洲洪流津洌洱洞洗����������������������������������活洽派洶洛泵洹洧洸洩洮洵洎洫炫為炳炬炯炭炸炮炤爰牲牯牴狩狠狡玷珊玻玲珍珀玳甚甭畏界畎畋疫疤疥疢疣癸皆皇皈盈盆盃盅省盹相眉看盾盼眇矜砂研砌砍祆祉祈祇禹禺科秒秋穿突竿竽籽紂紅紀紉紇約紆缸美羿耄�".split("");
	for (j = 0; j != D[172].length; ++j) if (D[172][j].charCodeAt(0) !== 65533) {
		e[D[172][j]] = 44032 + j;
		d[44032 + j] = D[172][j];
	}
	D[173] = "����������������������������������������������������������������耐耍耑耶胖胥胚胃胄背胡胛胎胞胤胝致舢苧范茅苣苛苦茄若茂茉苒苗英茁苜苔苑苞苓苟苯茆虐虹虻虺衍衫要觔計訂訃貞負赴赳趴軍軌述迦迢迪迥����������������������������������迭迫迤迨郊郎郁郃酋酊重閂限陋陌降面革韋韭音頁風飛食首香乘亳倌倍倣俯倦倥俸倩倖倆值借倚倒們俺倀倔倨俱倡個候倘俳修倭倪俾倫倉兼冤冥冢凍凌准凋剖剜剔剛剝匪卿原厝叟哨唐唁唷哼哥哲唆哺唔哩哭員唉哮哪�".split("");
	for (j = 0; j != D[173].length; ++j) if (D[173][j].charCodeAt(0) !== 65533) {
		e[D[173][j]] = 44288 + j;
		d[44288 + j] = D[173][j];
	}
	D[174] = "����������������������������������������������������������������哦唧唇哽唏圃圄埂埔埋埃堉夏套奘奚娑娘娜娟娛娓姬娠娣娩娥娌娉孫屘宰害家宴宮宵容宸射屑展屐峭峽峻峪峨峰島崁峴差席師庫庭座弱徒徑徐恙����������������������������������恣恥恐恕恭恩息悄悟悚悍悔悌悅悖扇拳挈拿捎挾振捕捂捆捏捉挺捐挽挪挫挨捍捌效敉料旁旅時晉晏晃晒晌晅晁書朔朕朗校核案框桓根桂桔栩梳栗桌桑栽柴桐桀格桃株桅栓栘桁殊殉殷氣氧氨氦氤泰浪涕消涇浦浸海浙涓�".split("");
	for (j = 0; j != D[174].length; ++j) if (D[174][j].charCodeAt(0) !== 65533) {
		e[D[174][j]] = 44544 + j;
		d[44544 + j] = D[174][j];
	}
	D[175] = "����������������������������������������������������������������浬涉浮浚浴浩涌涊浹涅浥涔烊烘烤烙烈烏爹特狼狹狽狸狷玆班琉珮珠珪珞畔畝畜畚留疾病症疲疳疽疼疹痂疸皋皰益盍盎眩真眠眨矩砰砧砸砝破砷����������������������������������砥砭砠砟砲祕祐祠祟祖神祝祗祚秤秣秧租秦秩秘窄窈站笆笑粉紡紗紋紊素索純紐紕級紜納紙紛缺罟羔翅翁耆耘耕耙耗耽耿胱脂胰脅胭胴脆胸胳脈能脊胼胯臭臬舀舐航舫舨般芻茫荒荔荊茸荐草茵茴荏茲茹茶茗荀茱茨荃�".split("");
	for (j = 0; j != D[175].length; ++j) if (D[175][j].charCodeAt(0) !== 65533) {
		e[D[175][j]] = 44800 + j;
		d[44800 + j] = D[175][j];
	}
	D[176] = "����������������������������������������������������������������虔蚊蚪蚓蚤蚩蚌蚣蚜衰衷袁袂衽衹記訐討訌訕訊託訓訖訏訑豈豺豹財貢起躬軒軔軏辱送逆迷退迺迴逃追逅迸邕郡郝郢酒配酌釘針釗釜釙閃院陣陡����������������������������������陛陝除陘陞隻飢馬骨高鬥鬲鬼乾偺偽停假偃偌做偉健偶偎偕偵側偷偏倏偯偭兜冕凰剪副勒務勘動匐匏匙匿區匾參曼商啪啦啄啞啡啃啊唱啖問啕唯啤唸售啜唬啣唳啁啗圈國圉域堅堊堆埠埤基堂堵執培夠奢娶婁婉婦婪婀�".split("");
	for (j = 0; j != D[176].length; ++j) if (D[176][j].charCodeAt(0) !== 65533) {
		e[D[176][j]] = 45056 + j;
		d[45056 + j] = D[176][j];
	}
	D[177] = "����������������������������������������������������������������娼婢婚婆婊孰寇寅寄寂宿密尉專將屠屜屝崇崆崎崛崖崢崑崩崔崙崤崧崗巢常帶帳帷康庸庶庵庾張強彗彬彩彫得徙從徘御徠徜恿患悉悠您惋悴惦悽����������������������������������情悻悵惜悼惘惕惆惟悸惚惇戚戛扈掠控捲掖探接捷捧掘措捱掩掉掃掛捫推掄授掙採掬排掏掀捻捩捨捺敝敖救教敗啟敏敘敕敔斜斛斬族旋旌旎晝晚晤晨晦晞曹勗望梁梯梢梓梵桿桶梱梧梗械梃棄梭梆梅梔條梨梟梡梂欲殺�".split("");
	for (j = 0; j != D[177].length; ++j) if (D[177][j].charCodeAt(0) !== 65533) {
		e[D[177][j]] = 45312 + j;
		d[45312 + j] = D[177][j];
	}
	D[178] = "����������������������������������������������������������������毫毬氫涎涼淳淙液淡淌淤添淺清淇淋涯淑涮淞淹涸混淵淅淒渚涵淚淫淘淪深淮淨淆淄涪淬涿淦烹焉焊烽烯爽牽犁猜猛猖猓猙率琅琊球理現琍瓠瓶����������������������������������瓷甜產略畦畢異疏痔痕疵痊痍皎盔盒盛眷眾眼眶眸眺硫硃硎祥票祭移窒窕笠笨笛第符笙笞笮粒粗粕絆絃統紮紹紼絀細紳組累終紲紱缽羞羚翌翎習耜聊聆脯脖脣脫脩脰脤舂舵舷舶船莎莞莘荸莢莖莽莫莒莊莓莉莠荷荻荼�".split("");
	for (j = 0; j != D[178].length; ++j) if (D[178][j].charCodeAt(0) !== 65533) {
		e[D[178][j]] = 45568 + j;
		d[45568 + j] = D[178][j];
	}
	D[179] = "����������������������������������������������������������������莆莧處彪蛇蛀蚶蛄蚵蛆蛋蚱蚯蛉術袞袈被袒袖袍袋覓規訪訝訣訥許設訟訛訢豉豚販責貫貨貪貧赧赦趾趺軛軟這逍通逗連速逝逐逕逞造透逢逖逛途����������������������������������部郭都酗野釵釦釣釧釭釩閉陪陵陳陸陰陴陶陷陬雀雪雩章竟頂頃魚鳥鹵鹿麥麻傢傍傅備傑傀傖傘傚最凱割剴創剩勞勝勛博厥啻喀喧啼喊喝喘喂喜喪喔喇喋喃喳單喟唾喲喚喻喬喱啾喉喫喙圍堯堪場堤堰報堡堝堠壹壺奠�".split("");
	for (j = 0; j != D[179].length; ++j) if (D[179][j].charCodeAt(0) !== 65533) {
		e[D[179][j]] = 45824 + j;
		d[45824 + j] = D[179][j];
	}
	D[180] = "����������������������������������������������������������������婷媚婿媒媛媧孳孱寒富寓寐尊尋就嵌嵐崴嵇巽幅帽幀幃幾廊廁廂廄弼彭復循徨惑惡悲悶惠愜愣惺愕惰惻惴慨惱愎惶愉愀愒戟扉掣掌描揀揩揉揆揍����������������������������������插揣提握揖揭揮捶援揪換摒揚揹敞敦敢散斑斐斯普晰晴晶景暑智晾晷曾替期朝棺棕棠棘棗椅棟棵森棧棹棒棲棣棋棍植椒椎棉棚楮棻款欺欽殘殖殼毯氮氯氬港游湔渡渲湧湊渠渥渣減湛湘渤湖湮渭渦湯渴湍渺測湃渝渾滋�".split("");
	for (j = 0; j != D[180].length; ++j) if (D[180][j].charCodeAt(0) !== 65533) {
		e[D[180][j]] = 46080 + j;
		d[46080 + j] = D[180][j];
	}
	D[181] = "����������������������������������������������������������������溉渙湎湣湄湲湩湟焙焚焦焰無然煮焜牌犄犀猶猥猴猩琺琪琳琢琥琵琶琴琯琛琦琨甥甦畫番痢痛痣痙痘痞痠登發皖皓皴盜睏短硝硬硯稍稈程稅稀窘����������������������������������窗窖童竣等策筆筐筒答筍筋筏筑粟粥絞結絨絕紫絮絲絡給絢絰絳善翔翕耋聒肅腕腔腋腑腎脹腆脾腌腓腴舒舜菩萃菸萍菠菅萋菁華菱菴著萊菰萌菌菽菲菊萸萎萄菜萇菔菟虛蛟蛙蛭蛔蛛蛤蛐蛞街裁裂袱覃視註詠評詞証詁�".split("");
	for (j = 0; j != D[181].length; ++j) if (D[181][j].charCodeAt(0) !== 65533) {
		e[D[181][j]] = 46336 + j;
		d[46336 + j] = D[181][j];
	}
	D[182] = "����������������������������������������������������������������詔詛詐詆訴診訶詖象貂貯貼貳貽賁費賀貴買貶貿貸越超趁跎距跋跚跑跌跛跆軻軸軼辜逮逵週逸進逶鄂郵鄉郾酣酥量鈔鈕鈣鈉鈞鈍鈐鈇鈑閔閏開閑����������������������������������間閒閎隊階隋陽隅隆隍陲隄雁雅雄集雇雯雲韌項順須飧飪飯飩飲飭馮馭黃黍黑亂傭債傲傳僅傾催傷傻傯僇剿剷剽募勦勤勢勣匯嗟嗨嗓嗦嗎嗜嗇嗑嗣嗤嗯嗚嗡嗅嗆嗥嗉園圓塞塑塘塗塚塔填塌塭塊塢塒塋奧嫁嫉嫌媾媽媼�".split("");
	for (j = 0; j != D[182].length; ++j) if (D[182][j].charCodeAt(0) !== 65533) {
		e[D[182][j]] = 46592 + j;
		d[46592 + j] = D[182][j];
	}
	D[183] = "����������������������������������������������������������������媳嫂媲嵩嵯幌幹廉廈弒彙徬微愚意慈感想愛惹愁愈慎慌慄慍愾愴愧愍愆愷戡戢搓搾搞搪搭搽搬搏搜搔損搶搖搗搆敬斟新暗暉暇暈暖暄暘暍會榔業����������������������������������楚楷楠楔極椰概楊楨楫楞楓楹榆楝楣楛歇歲毀殿毓毽溢溯滓溶滂源溝滇滅溥溘溼溺溫滑準溜滄滔溪溧溴煎煙煩煤煉照煜煬煦煌煥煞煆煨煖爺牒猷獅猿猾瑯瑚瑕瑟瑞瑁琿瑙瑛瑜當畸瘀痰瘁痲痱痺痿痴痳盞盟睛睫睦睞督�".split("");
	for (j = 0; j != D[183].length; ++j) if (D[183][j].charCodeAt(0) !== 65533) {
		e[D[183][j]] = 46848 + j;
		d[46848 + j] = D[183][j];
	}
	D[184] = "����������������������������������������������������������������睹睪睬睜睥睨睢矮碎碰碗碘碌碉硼碑碓硿祺祿禁萬禽稜稚稠稔稟稞窟窠筷節筠筮筧粱粳粵經絹綑綁綏絛置罩罪署義羨群聖聘肆肄腱腰腸腥腮腳腫����������������������������������腹腺腦舅艇蒂葷落萱葵葦葫葉葬葛萼萵葡董葩葭葆虞虜號蛹蜓蜈蜇蜀蛾蛻蜂蜃蜆蜊衙裟裔裙補裘裝裡裊裕裒覜解詫該詳試詩詰誇詼詣誠話誅詭詢詮詬詹詻訾詨豢貊貉賊資賈賄貲賃賂賅跡跟跨路跳跺跪跤跦躲較載軾輊�".split("");
	for (j = 0; j != D[184].length; ++j) if (D[184][j].charCodeAt(0) !== 65533) {
		e[D[184][j]] = 47104 + j;
		d[47104 + j] = D[184][j];
	}
	D[185] = "����������������������������������������������������������������辟農運遊道遂達逼違遐遇遏過遍遑逾遁鄒鄗酬酪酩釉鈷鉗鈸鈽鉀鈾鉛鉋鉤鉑鈴鉉鉍鉅鈹鈿鉚閘隘隔隕雍雋雉雊雷電雹零靖靴靶預頑頓頊頒頌飼飴����������������������������������飽飾馳馱馴髡鳩麂鼎鼓鼠僧僮僥僖僭僚僕像僑僱僎僩兢凳劃劂匱厭嗾嘀嘛嘗嗽嘔嘆嘉嘍嘎嗷嘖嘟嘈嘐嗶團圖塵塾境墓墊塹墅塽壽夥夢夤奪奩嫡嫦嫩嫗嫖嫘嫣孵寞寧寡寥實寨寢寤察對屢嶄嶇幛幣幕幗幔廓廖弊彆彰徹慇�".split("");
	for (j = 0; j != D[185].length; ++j) if (D[185][j].charCodeAt(0) !== 65533) {
		e[D[185][j]] = 47360 + j;
		d[47360 + j] = D[185][j];
	}
	D[186] = "����������������������������������������������������������������愿態慷慢慣慟慚慘慵截撇摘摔撤摸摟摺摑摧搴摭摻敲斡旗旖暢暨暝榜榨榕槁榮槓構榛榷榻榫榴槐槍榭槌榦槃榣歉歌氳漳演滾漓滴漩漾漠漬漏漂漢����������������������������������滿滯漆漱漸漲漣漕漫漯澈漪滬漁滲滌滷熔熙煽熊熄熒爾犒犖獄獐瑤瑣瑪瑰瑭甄疑瘧瘍瘋瘉瘓盡監瞄睽睿睡磁碟碧碳碩碣禎福禍種稱窪窩竭端管箕箋筵算箝箔箏箸箇箄粹粽精綻綰綜綽綾綠緊綴網綱綺綢綿綵綸維緒緇綬�".split("");
	for (j = 0; j != D[186].length; ++j) if (D[186][j].charCodeAt(0) !== 65533) {
		e[D[186][j]] = 47616 + j;
		d[47616 + j] = D[186][j];
	}
	D[187] = "����������������������������������������������������������������罰翠翡翟聞聚肇腐膀膏膈膊腿膂臧臺與舔舞艋蓉蒿蓆蓄蒙蒞蒲蒜蓋蒸蓀蓓蒐蒼蓑蓊蜿蜜蜻蜢蜥蜴蜘蝕蜷蜩裳褂裴裹裸製裨褚裯誦誌語誣認誡誓誤����������������������������������說誥誨誘誑誚誧豪貍貌賓賑賒赫趙趕跼輔輒輕輓辣遠遘遜遣遙遞遢遝遛鄙鄘鄞酵酸酷酴鉸銀銅銘銖鉻銓銜銨鉼銑閡閨閩閣閥閤隙障際雌雒需靼鞅韶頗領颯颱餃餅餌餉駁骯骰髦魁魂鳴鳶鳳麼鼻齊億儀僻僵價儂儈儉儅凜�".split("");
	for (j = 0; j != D[187].length; ++j) if (D[187][j].charCodeAt(0) !== 65533) {
		e[D[187][j]] = 47872 + j;
		d[47872 + j] = D[187][j];
	}
	D[188] = "����������������������������������������������������������������劇劈劉劍劊勰厲嘮嘻嘹嘲嘿嘴嘩噓噎噗噴嘶嘯嘰墀墟增墳墜墮墩墦奭嬉嫻嬋嫵嬌嬈寮寬審寫層履嶝嶔幢幟幡廢廚廟廝廣廠彈影德徵慶慧慮慝慕憂����������������������������������慼慰慫慾憧憐憫憎憬憚憤憔憮戮摩摯摹撞撲撈撐撰撥撓撕撩撒撮播撫撚撬撙撢撳敵敷數暮暫暴暱樣樟槨樁樞標槽模樓樊槳樂樅槭樑歐歎殤毅毆漿潼澄潑潦潔澆潭潛潸潮澎潺潰潤澗潘滕潯潠潟熟熬熱熨牖犛獎獗瑩璋璃�".split("");
	for (j = 0; j != D[188].length; ++j) if (D[188][j].charCodeAt(0) !== 65533) {
		e[D[188][j]] = 48128 + j;
		d[48128 + j] = D[188][j];
	}
	D[189] = "����������������������������������������������������������������瑾璀畿瘠瘩瘟瘤瘦瘡瘢皚皺盤瞎瞇瞌瞑瞋磋磅確磊碾磕碼磐稿稼穀稽稷稻窯窮箭箱範箴篆篇篁箠篌糊締練緯緻緘緬緝編緣線緞緩綞緙緲緹罵罷羯����������������������������������翩耦膛膜膝膠膚膘蔗蔽蔚蓮蔬蔭蔓蔑蔣蔡蔔蓬蔥蓿蔆螂蝴蝶蝠蝦蝸蝨蝙蝗蝌蝓衛衝褐複褒褓褕褊誼諒談諄誕請諸課諉諂調誰論諍誶誹諛豌豎豬賠賞賦賤賬賭賢賣賜質賡赭趟趣踫踐踝踢踏踩踟踡踞躺輝輛輟輩輦輪輜輞�".split("");
	for (j = 0; j != D[189].length; ++j) if (D[189][j].charCodeAt(0) !== 65533) {
		e[D[189][j]] = 48384 + j;
		d[48384 + j] = D[189][j];
	}
	D[190] = "����������������������������������������������������������������輥適遮遨遭遷鄰鄭鄧鄱醇醉醋醃鋅銻銷鋪銬鋤鋁銳銼鋒鋇鋰銲閭閱霄霆震霉靠鞍鞋鞏頡頫頜颳養餓餒餘駝駐駟駛駑駕駒駙骷髮髯鬧魅魄魷魯鴆鴉����������������������������������鴃麩麾黎墨齒儒儘儔儐儕冀冪凝劑劓勳噙噫噹噩噤噸噪器噥噱噯噬噢噶壁墾壇壅奮嬝嬴學寰導彊憲憑憩憊懍憶憾懊懈戰擅擁擋撻撼據擄擇擂操撿擒擔撾整曆曉暹曄曇暸樽樸樺橙橫橘樹橄橢橡橋橇樵機橈歙歷氅濂澱澡�".split("");
	for (j = 0; j != D[190].length; ++j) if (D[190][j].charCodeAt(0) !== 65533) {
		e[D[190][j]] = 48640 + j;
		d[48640 + j] = D[190][j];
	}
	D[191] = "����������������������������������������������������������������濃澤濁澧澳激澹澶澦澠澴熾燉燐燒燈燕熹燎燙燜燃燄獨璜璣璘璟璞瓢甌甍瘴瘸瘺盧盥瞠瞞瞟瞥磨磚磬磧禦積穎穆穌穋窺篙簑築篤篛篡篩篦糕糖縊����������������������������������縑縈縛縣縞縝縉縐罹羲翰翱翮耨膳膩膨臻興艘艙蕊蕙蕈蕨蕩蕃蕉蕭蕪蕞螃螟螞螢融衡褪褲褥褫褡親覦諦諺諫諱謀諜諧諮諾謁謂諷諭諳諶諼豫豭貓賴蹄踱踴蹂踹踵輻輯輸輳辨辦遵遴選遲遼遺鄴醒錠錶鋸錳錯錢鋼錫錄錚�".split("");
	for (j = 0; j != D[191].length; ++j) if (D[191][j].charCodeAt(0) !== 65533) {
		e[D[191][j]] = 48896 + j;
		d[48896 + j] = D[191][j];
	}
	D[192] = "����������������������������������������������������������������錐錦錡錕錮錙閻隧隨險雕霎霑霖霍霓霏靛靜靦鞘頰頸頻頷頭頹頤餐館餞餛餡餚駭駢駱骸骼髻髭鬨鮑鴕鴣鴦鴨鴒鴛默黔龍龜優償儡儲勵嚎嚀嚐嚅嚇����������������������������������嚏壕壓壑壎嬰嬪嬤孺尷屨嶼嶺嶽嶸幫彌徽應懂懇懦懋戲戴擎擊擘擠擰擦擬擱擢擭斂斃曙曖檀檔檄檢檜櫛檣橾檗檐檠歜殮毚氈濘濱濟濠濛濤濫濯澀濬濡濩濕濮濰燧營燮燦燥燭燬燴燠爵牆獰獲璩環璦璨癆療癌盪瞳瞪瞰瞬�".split("");
	for (j = 0; j != D[192].length; ++j) if (D[192][j].charCodeAt(0) !== 65533) {
		e[D[192][j]] = 49152 + j;
		d[49152 + j] = D[192][j];
	}
	D[193] = "����������������������������������������������������������������瞧瞭矯磷磺磴磯礁禧禪穗窿簇簍篾篷簌篠糠糜糞糢糟糙糝縮績繆縷縲繃縫總縱繅繁縴縹繈縵縿縯罄翳翼聱聲聰聯聳臆臃膺臂臀膿膽臉膾臨舉艱薪����������������������������������薄蕾薜薑薔薯薛薇薨薊虧蟀蟑螳蟒蟆螫螻螺蟈蟋褻褶襄褸褽覬謎謗謙講謊謠謝謄謐豁谿豳賺賽購賸賻趨蹉蹋蹈蹊轄輾轂轅輿避遽還邁邂邀鄹醣醞醜鍍鎂錨鍵鍊鍥鍋錘鍾鍬鍛鍰鍚鍔闊闋闌闈闆隱隸雖霜霞鞠韓顆颶餵騁�".split("");
	for (j = 0; j != D[193].length; ++j) if (D[193][j].charCodeAt(0) !== 65533) {
		e[D[193][j]] = 49408 + j;
		d[49408 + j] = D[193][j];
	}
	D[194] = "����������������������������������������������������������������駿鮮鮫鮪鮭鴻鴿麋黏點黜黝黛鼾齋叢嚕嚮壙壘嬸彝懣戳擴擲擾攆擺擻擷斷曜朦檳檬櫃檻檸櫂檮檯歟歸殯瀉瀋濾瀆濺瀑瀏燻燼燾燸獷獵璧璿甕癖癘����������������������������������癒瞽瞿瞻瞼礎禮穡穢穠竄竅簫簧簪簞簣簡糧織繕繞繚繡繒繙罈翹翻職聶臍臏舊藏薩藍藐藉薰薺薹薦蟯蟬蟲蟠覆覲觴謨謹謬謫豐贅蹙蹣蹦蹤蹟蹕軀轉轍邇邃邈醫醬釐鎔鎊鎖鎢鎳鎮鎬鎰鎘鎚鎗闔闖闐闕離雜雙雛雞霤鞣鞦�".split("");
	for (j = 0; j != D[194].length; ++j) if (D[194][j].charCodeAt(0) !== 65533) {
		e[D[194][j]] = 49664 + j;
		d[49664 + j] = D[194][j];
	}
	D[195] = "����������������������������������������������������������������鞭韹額顏題顎顓颺餾餿餽餮馥騎髁鬃鬆魏魎魍鯊鯉鯽鯈鯀鵑鵝鵠黠鼕鼬儳嚥壞壟壢寵龐廬懲懷懶懵攀攏曠曝櫥櫝櫚櫓瀛瀟瀨瀚瀝瀕瀘爆爍牘犢獸����������������������������������獺璽瓊瓣疇疆癟癡矇礙禱穫穩簾簿簸簽簷籀繫繭繹繩繪羅繳羶羹羸臘藩藝藪藕藤藥藷蟻蠅蠍蟹蟾襠襟襖襞譁譜識證譚譎譏譆譙贈贊蹼蹲躇蹶蹬蹺蹴轔轎辭邊邋醱醮鏡鏑鏟鏃鏈鏜鏝鏖鏢鏍鏘鏤鏗鏨關隴難霪霧靡韜韻類�".split("");
	for (j = 0; j != D[195].length; ++j) if (D[195][j].charCodeAt(0) !== 65533) {
		e[D[195][j]] = 49920 + j;
		d[49920 + j] = D[195][j];
	}
	D[196] = "����������������������������������������������������������������願顛颼饅饉騖騙鬍鯨鯧鯖鯛鶉鵡鵲鵪鵬麒麗麓麴勸嚨嚷嚶嚴嚼壤孀孃孽寶巉懸懺攘攔攙曦朧櫬瀾瀰瀲爐獻瓏癢癥礦礪礬礫竇競籌籃籍糯糰辮繽繼����������������������������������纂罌耀臚艦藻藹蘑藺蘆蘋蘇蘊蠔蠕襤覺觸議譬警譯譟譫贏贍躉躁躅躂醴釋鐘鐃鏽闡霰飄饒饑馨騫騰騷騵鰓鰍鹹麵黨鼯齟齣齡儷儸囁囀囂夔屬巍懼懾攝攜斕曩櫻欄櫺殲灌爛犧瓖瓔癩矓籐纏續羼蘗蘭蘚蠣蠢蠡蠟襪襬覽譴�".split("");
	for (j = 0; j != D[196].length; ++j) if (D[196][j].charCodeAt(0) !== 65533) {
		e[D[196][j]] = 50176 + j;
		d[50176 + j] = D[196][j];
	}
	D[197] = "����������������������������������������������������������������護譽贓躊躍躋轟辯醺鐮鐳鐵鐺鐸鐲鐫闢霸霹露響顧顥饗驅驃驀騾髏魔魑鰭鰥鶯鶴鷂鶸麝黯鼙齜齦齧儼儻囈囊囉孿巔巒彎懿攤權歡灑灘玀瓤疊癮癬����������������������������������禳籠籟聾聽臟襲襯觼讀贖贗躑躓轡酈鑄鑑鑒霽霾韃韁顫饕驕驍髒鬚鱉鰱鰾鰻鷓鷗鼴齬齪龔囌巖戀攣攫攪曬欐瓚竊籤籣籥纓纖纔臢蘸蘿蠱變邐邏鑣鑠鑤靨顯饜驚驛驗髓體髑鱔鱗鱖鷥麟黴囑壩攬灞癱癲矗罐羈蠶蠹衢讓讒�".split("");
	for (j = 0; j != D[197].length; ++j) if (D[197][j].charCodeAt(0) !== 65533) {
		e[D[197][j]] = 50432 + j;
		d[50432 + j] = D[197][j];
	}
	D[198] = "����������������������������������������������������������������讖艷贛釀鑪靂靈靄韆顰驟鬢魘鱟鷹鷺鹼鹽鼇齷齲廳欖灣籬籮蠻觀躡釁鑲鑰顱饞髖鬣黌灤矚讚鑷韉驢驥纜讜躪釅鑽鑾鑼鱷鱸黷豔鑿鸚爨驪鬱鸛鸞籲���������������������������������������������������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[198].length; ++j) if (D[198][j].charCodeAt(0) !== 65533) {
		e[D[198][j]] = 50688 + j;
		d[50688 + j] = D[198][j];
	}
	D[201] = "����������������������������������������������������������������乂乜凵匚厂万丌乇亍囗兀屮彳丏冇与丮亓仂仉仈冘勼卬厹圠夃夬尐巿旡殳毌气爿丱丼仨仜仩仡仝仚刌匜卌圢圣夗夯宁宄尒尻屴屳帄庀庂忉戉扐氕����������������������������������氶汃氿氻犮犰玊禸肊阞伎优伬仵伔仱伀价伈伝伂伅伢伓伄仴伒冱刓刉刐劦匢匟卍厊吇囡囟圮圪圴夼妀奼妅奻奾奷奿孖尕尥屼屺屻屾巟幵庄异弚彴忕忔忏扜扞扤扡扦扢扙扠扚扥旯旮朾朹朸朻机朿朼朳氘汆汒汜汏汊汔汋�".split("");
	for (j = 0; j != D[201].length; ++j) if (D[201][j].charCodeAt(0) !== 65533) {
		e[D[201][j]] = 51456 + j;
		d[51456 + j] = D[201][j];
	}
	D[202] = "����������������������������������������������������������������汌灱牞犴犵玎甪癿穵网艸艼芀艽艿虍襾邙邗邘邛邔阢阤阠阣佖伻佢佉体佤伾佧佒佟佁佘伭伳伿佡冏冹刜刞刡劭劮匉卣卲厎厏吰吷吪呔呅吙吜吥吘����������������������������������吽呏呁吨吤呇囮囧囥坁坅坌坉坋坒夆奀妦妘妠妗妎妢妐妏妧妡宎宒尨尪岍岏岈岋岉岒岊岆岓岕巠帊帎庋庉庌庈庍弅弝彸彶忒忑忐忭忨忮忳忡忤忣忺忯忷忻怀忴戺抃抌抎抏抔抇扱扻扺扰抁抈扷扽扲扴攷旰旴旳旲旵杅杇�".split("");
	for (j = 0; j != D[202].length; ++j) if (D[202][j].charCodeAt(0) !== 65533) {
		e[D[202][j]] = 51712 + j;
		d[51712 + j] = D[202][j];
	}
	D[203] = "����������������������������������������������������������������杙杕杌杈杝杍杚杋毐氙氚汸汧汫沄沋沏汱汯汩沚汭沇沕沜汦汳汥汻沎灴灺牣犿犽狃狆狁犺狅玕玗玓玔玒町甹疔疕皁礽耴肕肙肐肒肜芐芏芅芎芑芓����������������������������������芊芃芄豸迉辿邟邡邥邞邧邠阰阨阯阭丳侘佼侅佽侀侇佶佴侉侄佷佌侗佪侚佹侁佸侐侜侔侞侒侂侕佫佮冞冼冾刵刲刳剆刱劼匊匋匼厒厔咇呿咁咑咂咈呫呺呾呥呬呴呦咍呯呡呠咘呣呧呤囷囹坯坲坭坫坱坰坶垀坵坻坳坴坢�".split("");
	for (j = 0; j != D[203].length; ++j) if (D[203][j].charCodeAt(0) !== 65533) {
		e[D[203][j]] = 51968 + j;
		d[51968 + j] = D[203][j];
	}
	D[204] = "����������������������������������������������������������������坨坽夌奅妵妺姏姎妲姌姁妶妼姃姖妱妽姀姈妴姇孢孥宓宕屄屇岮岤岠岵岯岨岬岟岣岭岢岪岧岝岥岶岰岦帗帔帙弨弢弣弤彔徂彾彽忞忥怭怦怙怲怋����������������������������������怴怊怗怳怚怞怬怢怍怐怮怓怑怌怉怜戔戽抭抴拑抾抪抶拊抮抳抯抻抩抰抸攽斨斻昉旼昄昒昈旻昃昋昍昅旽昑昐曶朊枅杬枎枒杶杻枘枆构杴枍枌杺枟枑枙枃杽极杸杹枔欥殀歾毞氝沓泬泫泮泙沶泔沭泧沷泐泂沺泃泆泭泲�".split("");
	for (j = 0; j != D[204].length; ++j) if (D[204][j].charCodeAt(0) !== 65533) {
		e[D[204][j]] = 52224 + j;
		d[52224 + j] = D[204][j];
	}
	D[205] = "����������������������������������������������������������������泒泝沴沊沝沀泞泀洰泍泇沰泹泏泩泑炔炘炅炓炆炄炑炖炂炚炃牪狖狋狘狉狜狒狔狚狌狑玤玡玭玦玢玠玬玝瓝瓨甿畀甾疌疘皯盳盱盰盵矸矼矹矻矺����������������������������������矷祂礿秅穸穻竻籵糽耵肏肮肣肸肵肭舠芠苀芫芚芘芛芵芧芮芼芞芺芴芨芡芩苂芤苃芶芢虰虯虭虮豖迒迋迓迍迖迕迗邲邴邯邳邰阹阽阼阺陃俍俅俓侲俉俋俁俔俜俙侻侳俛俇俖侺俀侹俬剄剉勀勂匽卼厗厖厙厘咺咡咭咥哏�".split("");
	for (j = 0; j != D[205].length; ++j) if (D[205][j].charCodeAt(0) !== 65533) {
		e[D[205][j]] = 52480 + j;
		d[52480 + j] = D[205][j];
	}
	D[206] = "����������������������������������������������������������������哃茍咷咮哖咶哅哆咠呰咼咢咾呲哞咰垵垞垟垤垌垗垝垛垔垘垏垙垥垚垕壴复奓姡姞姮娀姱姝姺姽姼姶姤姲姷姛姩姳姵姠姾姴姭宨屌峐峘峌峗峋峛����������������������������������峞峚峉峇峊峖峓峔峏峈峆峎峟峸巹帡帢帣帠帤庰庤庢庛庣庥弇弮彖徆怷怹恔恲恞恅恓恇恉恛恌恀恂恟怤恄恘恦恮扂扃拏挍挋拵挎挃拫拹挏挌拸拶挀挓挔拺挕拻拰敁敃斪斿昶昡昲昵昜昦昢昳昫昺昝昴昹昮朏朐柁柲柈枺�".split("");
	for (j = 0; j != D[206].length; ++j) if (D[206][j].charCodeAt(0) !== 65533) {
		e[D[206][j]] = 52736 + j;
		d[52736 + j] = D[206][j];
	}
	D[207] = "����������������������������������������������������������������柜枻柸柘柀枷柅柫柤柟枵柍枳柷柶柮柣柂枹柎柧柰枲柼柆柭柌枮柦柛柺柉柊柃柪柋欨殂殄殶毖毘毠氠氡洨洴洭洟洼洿洒洊泚洳洄洙洺洚洑洀洝浂����������������������������������洁洘洷洃洏浀洇洠洬洈洢洉洐炷炟炾炱炰炡炴炵炩牁牉牊牬牰牳牮狊狤狨狫狟狪狦狣玅珌珂珈珅玹玶玵玴珫玿珇玾珃珆玸珋瓬瓮甮畇畈疧疪癹盄眈眃眄眅眊盷盻盺矧矨砆砑砒砅砐砏砎砉砃砓祊祌祋祅祄秕种秏秖秎窀�".split("");
	for (j = 0; j != D[207].length; ++j) if (D[207][j].charCodeAt(0) !== 65533) {
		e[D[207][j]] = 52992 + j;
		d[52992 + j] = D[207][j];
	}
	D[208] = "����������������������������������������������������������������穾竑笀笁籺籸籹籿粀粁紃紈紁罘羑羍羾耇耎耏耔耷胘胇胠胑胈胂胐胅胣胙胜胊胕胉胏胗胦胍臿舡芔苙苾苹茇苨茀苕茺苫苖苴苬苡苲苵茌苻苶苰苪����������������������������������苤苠苺苳苭虷虴虼虳衁衎衧衪衩觓訄訇赲迣迡迮迠郱邽邿郕郅邾郇郋郈釔釓陔陏陑陓陊陎倞倅倇倓倢倰倛俵俴倳倷倬俶俷倗倜倠倧倵倯倱倎党冔冓凊凄凅凈凎剡剚剒剞剟剕剢勍匎厞唦哢唗唒哧哳哤唚哿唄唈哫唑唅哱�".split("");
	for (j = 0; j != D[208].length; ++j) if (D[208][j].charCodeAt(0) !== 65533) {
		e[D[208][j]] = 53248 + j;
		d[53248 + j] = D[208][j];
	}
	D[209] = "����������������������������������������������������������������唊哻哷哸哠唎唃唋圁圂埌堲埕埒垺埆垽垼垸垶垿埇埐垹埁夎奊娙娖娭娮娕娏娗娊娞娳孬宧宭宬尃屖屔峬峿峮峱峷崀峹帩帨庨庮庪庬弳弰彧恝恚恧����������������������������������恁悢悈悀悒悁悝悃悕悛悗悇悜悎戙扆拲挐捖挬捄捅挶捃揤挹捋捊挼挩捁挴捘捔捙挭捇挳捚捑挸捗捀捈敊敆旆旃旄旂晊晟晇晑朒朓栟栚桉栲栳栻桋桏栖栱栜栵栫栭栯桎桄栴栝栒栔栦栨栮桍栺栥栠欬欯欭欱欴歭肂殈毦毤�".split("");
	for (j = 0; j != D[209].length; ++j) if (D[209][j].charCodeAt(0) !== 65533) {
		e[D[209][j]] = 53504 + j;
		d[53504 + j] = D[209][j];
	}
	D[210] = "����������������������������������������������������������������毨毣毢毧氥浺浣浤浶洍浡涒浘浢浭浯涑涍淯浿涆浞浧浠涗浰浼浟涂涘洯浨涋浾涀涄洖涃浻浽浵涐烜烓烑烝烋缹烢烗烒烞烠烔烍烅烆烇烚烎烡牂牸����������������������������������牷牶猀狺狴狾狶狳狻猁珓珙珥珖玼珧珣珩珜珒珛珔珝珚珗珘珨瓞瓟瓴瓵甡畛畟疰痁疻痄痀疿疶疺皊盉眝眛眐眓眒眣眑眕眙眚眢眧砣砬砢砵砯砨砮砫砡砩砳砪砱祔祛祏祜祓祒祑秫秬秠秮秭秪秜秞秝窆窉窅窋窌窊窇竘笐�".split("");
	for (j = 0; j != D[210].length; ++j) if (D[210][j].charCodeAt(0) !== 65533) {
		e[D[210][j]] = 53760 + j;
		d[53760 + j] = D[210][j];
	}
	D[211] = "����������������������������������������������������������������笄笓笅笏笈笊笎笉笒粄粑粊粌粈粍粅紞紝紑紎紘紖紓紟紒紏紌罜罡罞罠罝罛羖羒翃翂翀耖耾耹胺胲胹胵脁胻脀舁舯舥茳茭荄茙荑茥荖茿荁茦茜茢����������������������������������荂荎茛茪茈茼荍茖茤茠茷茯茩荇荅荌荓茞茬荋茧荈虓虒蚢蚨蚖蚍蚑蚞蚇蚗蚆蚋蚚蚅蚥蚙蚡蚧蚕蚘蚎蚝蚐蚔衃衄衭衵衶衲袀衱衿衯袃衾衴衼訒豇豗豻貤貣赶赸趵趷趶軑軓迾迵适迿迻逄迼迶郖郠郙郚郣郟郥郘郛郗郜郤酐�".split("");
	for (j = 0; j != D[211].length; ++j) if (D[211][j].charCodeAt(0) !== 65533) {
		e[D[211][j]] = 54016 + j;
		d[54016 + j] = D[211][j];
	}
	D[212] = "����������������������������������������������������������������酎酏釕釢釚陜陟隼飣髟鬯乿偰偪偡偞偠偓偋偝偲偈偍偁偛偊偢倕偅偟偩偫偣偤偆偀偮偳偗偑凐剫剭剬剮勖勓匭厜啵啶唼啍啐唴唪啑啢唶唵唰啒啅����������������������������������唌唲啥啎唹啈唭唻啀啋圊圇埻堔埢埶埜埴堀埭埽堈埸堋埳埏堇埮埣埲埥埬埡堎埼堐埧堁堌埱埩埰堍堄奜婠婘婕婧婞娸娵婭婐婟婥婬婓婤婗婃婝婒婄婛婈媎娾婍娹婌婰婩婇婑婖婂婜孲孮寁寀屙崞崋崝崚崠崌崨崍崦崥崏�".split("");
	for (j = 0; j != D[212].length; ++j) if (D[212][j].charCodeAt(0) !== 65533) {
		e[D[212][j]] = 54272 + j;
		d[54272 + j] = D[212][j];
	}
	D[213] = "����������������������������������������������������������������崰崒崣崟崮帾帴庱庴庹庲庳弶弸徛徖徟悊悐悆悾悰悺惓惔惏惤惙惝惈悱惛悷惊悿惃惍惀挲捥掊掂捽掽掞掭掝掗掫掎捯掇掐据掯捵掜捭掮捼掤挻掟����������������������������������捸掅掁掑掍捰敓旍晥晡晛晙晜晢朘桹梇梐梜桭桮梮梫楖桯梣梬梩桵桴梲梏桷梒桼桫桲梪梀桱桾梛梖梋梠梉梤桸桻梑梌梊桽欶欳欷欸殑殏殍殎殌氪淀涫涴涳湴涬淩淢涷淶淔渀淈淠淟淖涾淥淜淝淛淴淊涽淭淰涺淕淂淏淉�".split("");
	for (j = 0; j != D[213].length; ++j) if (D[213][j].charCodeAt(0) !== 65533) {
		e[D[213][j]] = 54528 + j;
		d[54528 + j] = D[213][j];
	}
	D[214] = "����������������������������������������������������������������淐淲淓淽淗淍淣涻烺焍烷焗烴焌烰焄烳焐烼烿焆焓焀烸烶焋焂焎牾牻牼牿猝猗猇猑猘猊猈狿猏猞玈珶珸珵琄琁珽琇琀珺珼珿琌琋珴琈畤畣痎痒痏����������������������������������痋痌痑痐皏皉盓眹眯眭眱眲眴眳眽眥眻眵硈硒硉硍硊硌砦硅硐祤祧祩祪祣祫祡离秺秸秶秷窏窔窐笵筇笴笥笰笢笤笳笘笪笝笱笫笭笯笲笸笚笣粔粘粖粣紵紽紸紶紺絅紬紩絁絇紾紿絊紻紨罣羕羜羝羛翊翋翍翐翑翇翏翉耟�".split("");
	for (j = 0; j != D[214].length; ++j) if (D[214][j].charCodeAt(0) !== 65533) {
		e[D[214][j]] = 54784 + j;
		d[54784 + j] = D[214][j];
	}
	D[215] = "����������������������������������������������������������������耞耛聇聃聈脘脥脙脛脭脟脬脞脡脕脧脝脢舑舸舳舺舴舲艴莐莣莨莍荺荳莤荴莏莁莕莙荵莔莩荽莃莌莝莛莪莋荾莥莯莈莗莰荿莦莇莮荶莚虙虖蚿蚷����������������������������������蛂蛁蛅蚺蚰蛈蚹蚳蚸蛌蚴蚻蚼蛃蚽蚾衒袉袕袨袢袪袚袑袡袟袘袧袙袛袗袤袬袌袓袎覂觖觙觕訰訧訬訞谹谻豜豝豽貥赽赻赹趼跂趹趿跁軘軞軝軜軗軠軡逤逋逑逜逌逡郯郪郰郴郲郳郔郫郬郩酖酘酚酓酕釬釴釱釳釸釤釹釪�".split("");
	for (j = 0; j != D[215].length; ++j) if (D[215][j].charCodeAt(0) !== 65533) {
		e[D[215][j]] = 55040 + j;
		d[55040 + j] = D[215][j];
	}
	D[216] = "����������������������������������������������������������������釫釷釨釮镺閆閈陼陭陫陱陯隿靪頄飥馗傛傕傔傞傋傣傃傌傎傝偨傜傒傂傇兟凔匒匑厤厧喑喨喥喭啷噅喢喓喈喏喵喁喣喒喤啽喌喦啿喕喡喎圌堩堷����������������������������������堙堞堧堣堨埵塈堥堜堛堳堿堶堮堹堸堭堬堻奡媯媔媟婺媢媞婸媦婼媥媬媕媮娷媄媊媗媃媋媩婻婽媌媜媏媓媝寪寍寋寔寑寊寎尌尰崷嵃嵫嵁嵋崿崵嵑嵎嵕崳崺嵒崽崱嵙嵂崹嵉崸崼崲崶嵀嵅幄幁彘徦徥徫惉悹惌惢惎惄愔�".split("");
	for (j = 0; j != D[216].length; ++j) if (D[216][j].charCodeAt(0) !== 65533) {
		e[D[216][j]] = 55296 + j;
		d[55296 + j] = D[216][j];
	}
	D[217] = "����������������������������������������������������������������惲愊愖愅惵愓惸惼惾惁愃愘愝愐惿愄愋扊掔掱掰揎揥揨揯揃撝揳揊揠揶揕揲揵摡揟掾揝揜揄揘揓揂揇揌揋揈揰揗揙攲敧敪敤敜敨敥斌斝斞斮旐旒����������������������������������晼晬晻暀晱晹晪晲朁椌棓椄棜椪棬棪棱椏棖棷棫棤棶椓椐棳棡椇棌椈楰梴椑棯棆椔棸棐棽棼棨椋椊椗棎棈棝棞棦棴棑椆棔棩椕椥棇欹欻欿欼殔殗殙殕殽毰毲毳氰淼湆湇渟湉溈渼渽湅湢渫渿湁湝湳渜渳湋湀湑渻渃渮湞�".split("");
	for (j = 0; j != D[217].length; ++j) if (D[217][j].charCodeAt(0) !== 65533) {
		e[D[217][j]] = 55552 + j;
		d[55552 + j] = D[217][j];
	}
	D[218] = "����������������������������������������������������������������湨湜湡渱渨湠湱湫渹渢渰湓湥渧湸湤湷湕湹湒湦渵渶湚焠焞焯烻焮焱焣焥焢焲焟焨焺焛牋牚犈犉犆犅犋猒猋猰猢猱猳猧猲猭猦猣猵猌琮琬琰琫琖����������������������������������琚琡琭琱琤琣琝琩琠琲瓻甯畯畬痧痚痡痦痝痟痤痗皕皒盚睆睇睄睍睅睊睎睋睌矞矬硠硤硥硜硭硱硪确硰硩硨硞硢祴祳祲祰稂稊稃稌稄窙竦竤筊笻筄筈筌筎筀筘筅粢粞粨粡絘絯絣絓絖絧絪絏絭絜絫絒絔絩絑絟絎缾缿罥�".split("");
	for (j = 0; j != D[218].length; ++j) if (D[218][j].charCodeAt(0) !== 65533) {
		e[D[218][j]] = 55808 + j;
		d[55808 + j] = D[218][j];
	}
	D[219] = "����������������������������������������������������������������罦羢羠羡翗聑聏聐胾胔腃腊腒腏腇脽腍脺臦臮臷臸臹舄舼舽舿艵茻菏菹萣菀菨萒菧菤菼菶萐菆菈菫菣莿萁菝菥菘菿菡菋菎菖菵菉萉萏菞萑萆菂菳����������������������������������菕菺菇菑菪萓菃菬菮菄菻菗菢萛菛菾蛘蛢蛦蛓蛣蛚蛪蛝蛫蛜蛬蛩蛗蛨蛑衈衖衕袺裗袹袸裀袾袶袼袷袽袲褁裉覕覘覗觝觚觛詎詍訹詙詀詗詘詄詅詒詈詑詊詌詏豟貁貀貺貾貰貹貵趄趀趉跘跓跍跇跖跜跏跕跙跈跗跅軯軷軺�".split("");
	for (j = 0; j != D[219].length; ++j) if (D[219][j].charCodeAt(0) !== 65533) {
		e[D[219][j]] = 56064 + j;
		d[56064 + j] = D[219][j];
	}
	D[220] = "����������������������������������������������������������������軹軦軮軥軵軧軨軶軫軱軬軴軩逭逴逯鄆鄬鄄郿郼鄈郹郻鄁鄀鄇鄅鄃酡酤酟酢酠鈁鈊鈥鈃鈚鈦鈏鈌鈀鈒釿釽鈆鈄鈧鈂鈜鈤鈙鈗鈅鈖镻閍閌閐隇陾隈����������������������������������隉隃隀雂雈雃雱雰靬靰靮頇颩飫鳦黹亃亄亶傽傿僆傮僄僊傴僈僂傰僁傺傱僋僉傶傸凗剺剸剻剼嗃嗛嗌嗐嗋嗊嗝嗀嗔嗄嗩喿嗒喍嗏嗕嗢嗖嗈嗲嗍嗙嗂圔塓塨塤塏塍塉塯塕塎塝塙塥塛堽塣塱壼嫇嫄嫋媺媸媱媵媰媿嫈媻嫆�".split("");
	for (j = 0; j != D[220].length; ++j) if (D[220][j].charCodeAt(0) !== 65533) {
		e[D[220][j]] = 56320 + j;
		d[56320 + j] = D[220][j];
	}
	D[221] = "����������������������������������������������������������������媷嫀嫊媴媶嫍媹媐寖寘寙尟尳嵱嵣嵊嵥嵲嵬嵞嵨嵧嵢巰幏幎幊幍幋廅廌廆廋廇彀徯徭惷慉慊愫慅愶愲愮慆愯慏愩慀戠酨戣戥戤揅揱揫搐搒搉搠搤����������������������������������搳摃搟搕搘搹搷搢搣搌搦搰搨摁搵搯搊搚摀搥搧搋揧搛搮搡搎敯斒旓暆暌暕暐暋暊暙暔晸朠楦楟椸楎楢楱椿楅楪椹楂楗楙楺楈楉椵楬椳椽楥棰楸椴楩楀楯楄楶楘楁楴楌椻楋椷楜楏楑椲楒椯楻椼歆歅歃歂歈歁殛嗀毻毼�".split("");
	for (j = 0; j != D[221].length; ++j) if (D[221][j].charCodeAt(0) !== 65533) {
		e[D[221][j]] = 56576 + j;
		d[56576 + j] = D[221][j];
	}
	D[222] = "����������������������������������������������������������������毹毷毸溛滖滈溏滀溟溓溔溠溱溹滆滒溽滁溞滉溷溰滍溦滏溲溾滃滜滘溙溒溎溍溤溡溿溳滐滊溗溮溣煇煔煒煣煠煁煝煢煲煸煪煡煂煘煃煋煰煟煐煓����������������������������������煄煍煚牏犍犌犑犐犎猼獂猻猺獀獊獉瑄瑊瑋瑒瑑瑗瑀瑏瑐瑎瑂瑆瑍瑔瓡瓿瓾瓽甝畹畷榃痯瘏瘃痷痾痼痹痸瘐痻痶痭痵痽皙皵盝睕睟睠睒睖睚睩睧睔睙睭矠碇碚碔碏碄碕碅碆碡碃硹碙碀碖硻祼禂祽祹稑稘稙稒稗稕稢稓�".split("");
	for (j = 0; j != D[222].length; ++j) if (D[222][j].charCodeAt(0) !== 65533) {
		e[D[222][j]] = 56832 + j;
		d[56832 + j] = D[222][j];
	}
	D[223] = "����������������������������������������������������������������稛稐窣窢窞竫筦筤筭筴筩筲筥筳筱筰筡筸筶筣粲粴粯綈綆綀綍絿綅絺綎絻綃絼綌綔綄絽綒罭罫罧罨罬羦羥羧翛翜耡腤腠腷腜腩腛腢腲朡腞腶腧腯����������������������������������腄腡舝艉艄艀艂艅蓱萿葖葶葹蒏蒍葥葑葀蒆葧萰葍葽葚葙葴葳葝蔇葞萷萺萴葺葃葸萲葅萩菙葋萯葂萭葟葰萹葎葌葒葯蓅蒎萻葇萶萳葨葾葄萫葠葔葮葐蜋蜄蛷蜌蛺蛖蛵蝍蛸蜎蜉蜁蛶蜍蜅裖裋裍裎裞裛裚裌裐覅覛觟觥觤�".split("");
	for (j = 0; j != D[223].length; ++j) if (D[223][j].charCodeAt(0) !== 65533) {
		e[D[223][j]] = 57088 + j;
		d[57088 + j] = D[223][j];
	}
	D[224] = "����������������������������������������������������������������觡觠觢觜触詶誆詿詡訿詷誂誄詵誃誁詴詺谼豋豊豥豤豦貆貄貅賌赨赩趑趌趎趏趍趓趔趐趒跰跠跬跱跮跐跩跣跢跧跲跫跴輆軿輁輀輅輇輈輂輋遒逿����������������������������������遄遉逽鄐鄍鄏鄑鄖鄔鄋鄎酮酯鉈鉒鈰鈺鉦鈳鉥鉞銃鈮鉊鉆鉭鉬鉏鉠鉧鉯鈶鉡鉰鈱鉔鉣鉐鉲鉎鉓鉌鉖鈲閟閜閞閛隒隓隑隗雎雺雽雸雵靳靷靸靲頏頍頎颬飶飹馯馲馰馵骭骫魛鳪鳭鳧麀黽僦僔僗僨僳僛僪僝僤僓僬僰僯僣僠�".split("");
	for (j = 0; j != D[224].length; ++j) if (D[224][j].charCodeAt(0) !== 65533) {
		e[D[224][j]] = 57344 + j;
		d[57344 + j] = D[224][j];
	}
	D[225] = "����������������������������������������������������������������凘劀劁勩勫匰厬嘧嘕嘌嘒嗼嘏嘜嘁嘓嘂嗺嘝嘄嗿嗹墉塼墐墘墆墁塿塴墋塺墇墑墎塶墂墈塻墔墏壾奫嫜嫮嫥嫕嫪嫚嫭嫫嫳嫢嫠嫛嫬嫞嫝嫙嫨嫟孷寠����������������������������������寣屣嶂嶀嵽嶆嵺嶁嵷嶊嶉嶈嵾嵼嶍嵹嵿幘幙幓廘廑廗廎廜廕廙廒廔彄彃彯徶愬愨慁慞慱慳慒慓慲慬憀慴慔慺慛慥愻慪慡慖戩戧戫搫摍摛摝摴摶摲摳摽摵摦撦摎撂摞摜摋摓摠摐摿搿摬摫摙摥摷敳斠暡暠暟朅朄朢榱榶槉�".split("");
	for (j = 0; j != D[225].length; ++j) if (D[225][j].charCodeAt(0) !== 65533) {
		e[D[225][j]] = 57600 + j;
		d[57600 + j] = D[225][j];
	}
	D[226] = "����������������������������������������������������������������榠槎榖榰榬榼榑榙榎榧榍榩榾榯榿槄榽榤槔榹槊榚槏榳榓榪榡榞槙榗榐槂榵榥槆歊歍歋殞殟殠毃毄毾滎滵滱漃漥滸漷滻漮漉潎漙漚漧漘漻漒滭漊����������������������������������漶潳滹滮漭潀漰漼漵滫漇漎潃漅滽滶漹漜滼漺漟漍漞漈漡熇熐熉熀熅熂熏煻熆熁熗牄牓犗犕犓獃獍獑獌瑢瑳瑱瑵瑲瑧瑮甀甂甃畽疐瘖瘈瘌瘕瘑瘊瘔皸瞁睼瞅瞂睮瞀睯睾瞃碲碪碴碭碨硾碫碞碥碠碬碢碤禘禊禋禖禕禔禓�".split("");
	for (j = 0; j != D[226].length; ++j) if (D[226][j].charCodeAt(0) !== 65533) {
		e[D[226][j]] = 57856 + j;
		d[57856 + j] = D[226][j];
	}
	D[227] = "����������������������������������������������������������������禗禈禒禐稫穊稰稯稨稦窨窫窬竮箈箜箊箑箐箖箍箌箛箎箅箘劄箙箤箂粻粿粼粺綧綷緂綣綪緁緀緅綝緎緄緆緋緌綯綹綖綼綟綦綮綩綡緉罳翢翣翥翞����������������������������������耤聝聜膉膆膃膇膍膌膋舕蒗蒤蒡蒟蒺蓎蓂蒬蒮蒫蒹蒴蓁蓍蒪蒚蒱蓐蒝蒧蒻蒢蒔蓇蓌蒛蒩蒯蒨蓖蒘蒶蓏蒠蓗蓔蓒蓛蒰蒑虡蜳蜣蜨蝫蝀蜮蜞蜡蜙蜛蝃蜬蝁蜾蝆蜠蜲蜪蜭蜼蜒蜺蜱蜵蝂蜦蜧蜸蜤蜚蜰蜑裷裧裱裲裺裾裮裼裶裻�".split("");
	for (j = 0; j != D[227].length; ++j) if (D[227][j].charCodeAt(0) !== 65533) {
		e[D[227][j]] = 58112 + j;
		d[58112 + j] = D[227][j];
	}
	D[228] = "����������������������������������������������������������������裰裬裫覝覡覟覞觩觫觨誫誙誋誒誏誖谽豨豩賕賏賗趖踉踂跿踍跽踊踃踇踆踅跾踀踄輐輑輎輍鄣鄜鄠鄢鄟鄝鄚鄤鄡鄛酺酲酹酳銥銤鉶銛鉺銠銔銪銍����������������������������������銦銚銫鉹銗鉿銣鋮銎銂銕銢鉽銈銡銊銆銌銙銧鉾銇銩銝銋鈭隞隡雿靘靽靺靾鞃鞀鞂靻鞄鞁靿韎韍頖颭颮餂餀餇馝馜駃馹馻馺駂馽駇骱髣髧鬾鬿魠魡魟鳱鳲鳵麧僿儃儰僸儆儇僶僾儋儌僽儊劋劌勱勯噈噂噌嘵噁噊噉噆噘�".split("");
	for (j = 0; j != D[228].length; ++j) if (D[228][j].charCodeAt(0) !== 65533) {
		e[D[228][j]] = 58368 + j;
		d[58368 + j] = D[228][j];
	}
	D[229] = "����������������������������������������������������������������噚噀嘳嘽嘬嘾嘸嘪嘺圚墫墝墱墠墣墯墬墥墡壿嫿嫴嫽嫷嫶嬃嫸嬂嫹嬁嬇嬅嬏屧嶙嶗嶟嶒嶢嶓嶕嶠嶜嶡嶚嶞幩幝幠幜緳廛廞廡彉徲憋憃慹憱憰憢憉����������������������������������憛憓憯憭憟憒憪憡憍慦憳戭摮摰撖撠撅撗撜撏撋撊撌撣撟摨撱撘敶敺敹敻斲斳暵暰暩暲暷暪暯樀樆樗槥槸樕槱槤樠槿槬槢樛樝槾樧槲槮樔槷槧橀樈槦槻樍槼槫樉樄樘樥樏槶樦樇槴樖歑殥殣殢殦氁氀毿氂潁漦潾澇濆澒�".split("");
	for (j = 0; j != D[229].length; ++j) if (D[229][j].charCodeAt(0) !== 65533) {
		e[D[229][j]] = 58624 + j;
		d[58624 + j] = D[229][j];
	}
	D[230] = "����������������������������������������������������������������澍澉澌潢潏澅潚澖潶潬澂潕潲潒潐潗澔澓潝漀潡潫潽潧澐潓澋潩潿澕潣潷潪潻熲熯熛熰熠熚熩熵熝熥熞熤熡熪熜熧熳犘犚獘獒獞獟獠獝獛獡獚獙����������������������������������獢璇璉璊璆璁瑽璅璈瑼瑹甈甇畾瘥瘞瘙瘝瘜瘣瘚瘨瘛皜皝皞皛瞍瞏瞉瞈磍碻磏磌磑磎磔磈磃磄磉禚禡禠禜禢禛歶稹窲窴窳箷篋箾箬篎箯箹篊箵糅糈糌糋緷緛緪緧緗緡縃緺緦緶緱緰緮緟罶羬羰羭翭翫翪翬翦翨聤聧膣膟�".split("");
	for (j = 0; j != D[230].length; ++j) if (D[230][j].charCodeAt(0) !== 65533) {
		e[D[230][j]] = 58880 + j;
		d[58880 + j] = D[230][j];
	}
	D[231] = "����������������������������������������������������������������膞膕膢膙膗舖艏艓艒艐艎艑蔤蔻蔏蔀蔩蔎蔉蔍蔟蔊蔧蔜蓻蔫蓺蔈蔌蓴蔪蓲蔕蓷蓫蓳蓼蔒蓪蓩蔖蓾蔨蔝蔮蔂蓽蔞蓶蔱蔦蓧蓨蓰蓯蓹蔘蔠蔰蔋蔙蔯虢����������������������������������蝖蝣蝤蝷蟡蝳蝘蝔蝛蝒蝡蝚蝑蝞蝭蝪蝐蝎蝟蝝蝯蝬蝺蝮蝜蝥蝏蝻蝵蝢蝧蝩衚褅褌褔褋褗褘褙褆褖褑褎褉覢覤覣觭觰觬諏諆誸諓諑諔諕誻諗誾諀諅諘諃誺誽諙谾豍貏賥賟賙賨賚賝賧趠趜趡趛踠踣踥踤踮踕踛踖踑踙踦踧�".split("");
	for (j = 0; j != D[231].length; ++j) if (D[231][j].charCodeAt(0) !== 65533) {
		e[D[231][j]] = 59136 + j;
		d[59136 + j] = D[231][j];
	}
	D[232] = "����������������������������������������������������������������踔踒踘踓踜踗踚輬輤輘輚輠輣輖輗遳遰遯遧遫鄯鄫鄩鄪鄲鄦鄮醅醆醊醁醂醄醀鋐鋃鋄鋀鋙銶鋏鋱鋟鋘鋩鋗鋝鋌鋯鋂鋨鋊鋈鋎鋦鋍鋕鋉鋠鋞鋧鋑鋓����������������������������������銵鋡鋆銴镼閬閫閮閰隤隢雓霅霈霂靚鞊鞎鞈韐韏頞頝頦頩頨頠頛頧颲餈飺餑餔餖餗餕駜駍駏駓駔駎駉駖駘駋駗駌骳髬髫髳髲髱魆魃魧魴魱魦魶魵魰魨魤魬鳼鳺鳽鳿鳷鴇鴀鳹鳻鴈鴅鴄麃黓鼏鼐儜儓儗儚儑凞匴叡噰噠噮�".split("");
	for (j = 0; j != D[232].length; ++j) if (D[232][j].charCodeAt(0) !== 65533) {
		e[D[232][j]] = 59392 + j;
		d[59392 + j] = D[232][j];
	}
	D[233] = "����������������������������������������������������������������噳噦噣噭噲噞噷圜圛壈墽壉墿墺壂墼壆嬗嬙嬛嬡嬔嬓嬐嬖嬨嬚嬠嬞寯嶬嶱嶩嶧嶵嶰嶮嶪嶨嶲嶭嶯嶴幧幨幦幯廩廧廦廨廥彋徼憝憨憖懅憴懆懁懌憺����������������������������������憿憸憌擗擖擐擏擉撽撉擃擛擳擙攳敿敼斢曈暾曀曊曋曏暽暻暺曌朣樴橦橉橧樲橨樾橝橭橶橛橑樨橚樻樿橁橪橤橐橏橔橯橩橠樼橞橖橕橍橎橆歕歔歖殧殪殫毈毇氄氃氆澭濋澣濇澼濎濈潞濄澽澞濊澨瀄澥澮澺澬澪濏澿澸�".split("");
	for (j = 0; j != D[233].length; ++j) if (D[233][j].charCodeAt(0) !== 65533) {
		e[D[233][j]] = 59648 + j;
		d[59648 + j] = D[233][j];
	}
	D[234] = "����������������������������������������������������������������澢濉澫濍澯澲澰燅燂熿熸燖燀燁燋燔燊燇燏熽燘熼燆燚燛犝犞獩獦獧獬獥獫獪瑿璚璠璔璒璕璡甋疀瘯瘭瘱瘽瘳瘼瘵瘲瘰皻盦瞚瞝瞡瞜瞛瞢瞣瞕瞙����������������������������������瞗磝磩磥磪磞磣磛磡磢磭磟磠禤穄穈穇窶窸窵窱窷篞篣篧篝篕篥篚篨篹篔篪篢篜篫篘篟糒糔糗糐糑縒縡縗縌縟縠縓縎縜縕縚縢縋縏縖縍縔縥縤罃罻罼罺羱翯耪耩聬膱膦膮膹膵膫膰膬膴膲膷膧臲艕艖艗蕖蕅蕫蕍蕓蕡蕘�".split("");
	for (j = 0; j != D[234].length; ++j) if (D[234][j].charCodeAt(0) !== 65533) {
		e[D[234][j]] = 59904 + j;
		d[59904 + j] = D[234][j];
	}
	D[235] = "����������������������������������������������������������������蕀蕆蕤蕁蕢蕄蕑蕇蕣蔾蕛蕱蕎蕮蕵蕕蕧蕠薌蕦蕝蕔蕥蕬虣虥虤螛螏螗螓螒螈螁螖螘蝹螇螣螅螐螑螝螄螔螜螚螉褞褦褰褭褮褧褱褢褩褣褯褬褟觱諠����������������������������������諢諲諴諵諝謔諤諟諰諈諞諡諨諿諯諻貑貒貐賵賮賱賰賳赬赮趥趧踳踾踸蹀蹅踶踼踽蹁踰踿躽輶輮輵輲輹輷輴遶遹遻邆郺鄳鄵鄶醓醐醑醍醏錧錞錈錟錆錏鍺錸錼錛錣錒錁鍆錭錎錍鋋錝鋺錥錓鋹鋷錴錂錤鋿錩錹錵錪錔錌�".split("");
	for (j = 0; j != D[235].length; ++j) if (D[235][j].charCodeAt(0) !== 65533) {
		e[D[235][j]] = 60160 + j;
		d[60160 + j] = D[235][j];
	}
	D[236] = "����������������������������������������������������������������錋鋾錉錀鋻錖閼闍閾閹閺閶閿閵閽隩雔霋霒霐鞙鞗鞔韰韸頵頯頲餤餟餧餩馞駮駬駥駤駰駣駪駩駧骹骿骴骻髶髺髹髷鬳鮀鮅鮇魼魾魻鮂鮓鮒鮐魺鮕����������������������������������魽鮈鴥鴗鴠鴞鴔鴩鴝鴘鴢鴐鴙鴟麈麆麇麮麭黕黖黺鼒鼽儦儥儢儤儠儩勴嚓嚌嚍嚆嚄嚃噾嚂噿嚁壖壔壏壒嬭嬥嬲嬣嬬嬧嬦嬯嬮孻寱寲嶷幬幪徾徻懃憵憼懧懠懥懤懨懞擯擩擣擫擤擨斁斀斶旚曒檍檖檁檥檉檟檛檡檞檇檓檎�".split("");
	for (j = 0; j != D[236].length; ++j) if (D[236][j].charCodeAt(0) !== 65533) {
		e[D[236][j]] = 60416 + j;
		d[60416 + j] = D[236][j];
	}
	D[237] = "����������������������������������������������������������������檕檃檨檤檑橿檦檚檅檌檒歛殭氉濌澩濴濔濣濜濭濧濦濞濲濝濢濨燡燱燨燲燤燰燢獳獮獯璗璲璫璐璪璭璱璥璯甐甑甒甏疄癃癈癉癇皤盩瞵瞫瞲瞷瞶����������������������������������瞴瞱瞨矰磳磽礂磻磼磲礅磹磾礄禫禨穜穛穖穘穔穚窾竀竁簅簏篲簀篿篻簎篴簋篳簂簉簃簁篸篽簆篰篱簐簊糨縭縼繂縳顈縸縪繉繀繇縩繌縰縻縶繄縺罅罿罾罽翴翲耬膻臄臌臊臅臇膼臩艛艚艜薃薀薏薧薕薠薋薣蕻薤薚薞�".split("");
	for (j = 0; j != D[237].length; ++j) if (D[237][j].charCodeAt(0) !== 65533) {
		e[D[237][j]] = 60672 + j;
		d[60672 + j] = D[237][j];
	}
	D[238] = "����������������������������������������������������������������蕷蕼薉薡蕺蕸蕗薎薖薆薍薙薝薁薢薂薈薅蕹蕶薘薐薟虨螾螪螭蟅螰螬螹螵螼螮蟉蟃蟂蟌螷螯蟄蟊螴螶螿螸螽蟞螲褵褳褼褾襁襒褷襂覭覯覮觲觳謞����������������������������������謘謖謑謅謋謢謏謒謕謇謍謈謆謜謓謚豏豰豲豱豯貕貔賹赯蹎蹍蹓蹐蹌蹇轃轀邅遾鄸醚醢醛醙醟醡醝醠鎡鎃鎯鍤鍖鍇鍼鍘鍜鍶鍉鍐鍑鍠鍭鎏鍌鍪鍹鍗鍕鍒鍏鍱鍷鍻鍡鍞鍣鍧鎀鍎鍙闇闀闉闃闅閷隮隰隬霠霟霘霝霙鞚鞡鞜�".split("");
	for (j = 0; j != D[238].length; ++j) if (D[238][j].charCodeAt(0) !== 65533) {
		e[D[238][j]] = 60928 + j;
		d[60928 + j] = D[238][j];
	}
	D[239] = "����������������������������������������������������������������鞞鞝韕韔韱顁顄顊顉顅顃餥餫餬餪餳餲餯餭餱餰馘馣馡騂駺駴駷駹駸駶駻駽駾駼騃骾髾髽鬁髼魈鮚鮨鮞鮛鮦鮡鮥鮤鮆鮢鮠鮯鴳鵁鵧鴶鴮鴯鴱鴸鴰����������������������������������鵅鵂鵃鴾鴷鵀鴽翵鴭麊麉麍麰黈黚黻黿鼤鼣鼢齔龠儱儭儮嚘嚜嚗嚚嚝嚙奰嬼屩屪巀幭幮懘懟懭懮懱懪懰懫懖懩擿攄擽擸攁攃擼斔旛曚曛曘櫅檹檽櫡櫆檺檶檷櫇檴檭歞毉氋瀇瀌瀍瀁瀅瀔瀎濿瀀濻瀦濼濷瀊爁燿燹爃燽獶�".split("");
	for (j = 0; j != D[239].length; ++j) if (D[239][j].charCodeAt(0) !== 65533) {
		e[D[239][j]] = 61184 + j;
		d[61184 + j] = D[239][j];
	}
	D[240] = "����������������������������������������������������������������璸瓀璵瓁璾璶璻瓂甔甓癜癤癙癐癓癗癚皦皽盬矂瞺磿礌礓礔礉礐礒礑禭禬穟簜簩簙簠簟簭簝簦簨簢簥簰繜繐繖繣繘繢繟繑繠繗繓羵羳翷翸聵臑臒����������������������������������臐艟艞薴藆藀藃藂薳薵薽藇藄薿藋藎藈藅薱薶藒蘤薸薷薾虩蟧蟦蟢蟛蟫蟪蟥蟟蟳蟤蟔蟜蟓蟭蟘蟣螤蟗蟙蠁蟴蟨蟝襓襋襏襌襆襐襑襉謪謧謣謳謰謵譇謯謼謾謱謥謷謦謶謮謤謻謽謺豂豵貙貘貗賾贄贂贀蹜蹢蹠蹗蹖蹞蹥蹧�".split("");
	for (j = 0; j != D[240].length; ++j) if (D[240][j].charCodeAt(0) !== 65533) {
		e[D[240][j]] = 61440 + j;
		d[61440 + j] = D[240][j];
	}
	D[241] = "����������������������������������������������������������������蹛蹚蹡蹝蹩蹔轆轇轈轋鄨鄺鄻鄾醨醥醧醯醪鎵鎌鎒鎷鎛鎝鎉鎧鎎鎪鎞鎦鎕鎈鎙鎟鎍鎱鎑鎲鎤鎨鎴鎣鎥闒闓闑隳雗雚巂雟雘雝霣霢霥鞬鞮鞨鞫鞤鞪����������������������������������鞢鞥韗韙韖韘韺顐顑顒颸饁餼餺騏騋騉騍騄騑騊騅騇騆髀髜鬈鬄鬅鬩鬵魊魌魋鯇鯆鯃鮿鯁鮵鮸鯓鮶鯄鮹鮽鵜鵓鵏鵊鵛鵋鵙鵖鵌鵗鵒鵔鵟鵘鵚麎麌黟鼁鼀鼖鼥鼫鼪鼩鼨齌齕儴儵劖勷厴嚫嚭嚦嚧嚪嚬壚壝壛夒嬽嬾嬿巃幰�".split("");
	for (j = 0; j != D[241].length; ++j) if (D[241][j].charCodeAt(0) !== 65533) {
		e[D[241][j]] = 61696 + j;
		d[61696 + j] = D[241][j];
	}
	D[242] = "����������������������������������������������������������������徿懻攇攐攍攉攌攎斄旞旝曞櫧櫠櫌櫑櫙櫋櫟櫜櫐櫫櫏櫍櫞歠殰氌瀙瀧瀠瀖瀫瀡瀢瀣瀩瀗瀤瀜瀪爌爊爇爂爅犥犦犤犣犡瓋瓅璷瓃甖癠矉矊矄矱礝礛����������������������������������礡礜礗礞禰穧穨簳簼簹簬簻糬糪繶繵繸繰繷繯繺繲繴繨罋罊羃羆羷翽翾聸臗臕艤艡艣藫藱藭藙藡藨藚藗藬藲藸藘藟藣藜藑藰藦藯藞藢蠀蟺蠃蟶蟷蠉蠌蠋蠆蟼蠈蟿蠊蠂襢襚襛襗襡襜襘襝襙覈覷覶觶譐譈譊譀譓譖譔譋譕�".split("");
	for (j = 0; j != D[242].length; ++j) if (D[242][j].charCodeAt(0) !== 65533) {
		e[D[242][j]] = 61952 + j;
		d[61952 + j] = D[242][j];
	}
	D[243] = "����������������������������������������������������������������譑譂譒譗豃豷豶貚贆贇贉趬趪趭趫蹭蹸蹳蹪蹯蹻軂轒轑轏轐轓辴酀鄿醰醭鏞鏇鏏鏂鏚鏐鏹鏬鏌鏙鎩鏦鏊鏔鏮鏣鏕鏄鏎鏀鏒鏧镽闚闛雡霩霫霬霨霦����������������������������������鞳鞷鞶韝韞韟顜顙顝顗颿颽颻颾饈饇饃馦馧騚騕騥騝騤騛騢騠騧騣騞騜騔髂鬋鬊鬎鬌鬷鯪鯫鯠鯞鯤鯦鯢鯰鯔鯗鯬鯜鯙鯥鯕鯡鯚鵷鶁鶊鶄鶈鵱鶀鵸鶆鶋鶌鵽鵫鵴鵵鵰鵩鶅鵳鵻鶂鵯鵹鵿鶇鵨麔麑黀黼鼭齀齁齍齖齗齘匷嚲�".split("");
	for (j = 0; j != D[243].length; ++j) if (D[243][j].charCodeAt(0) !== 65533) {
		e[D[243][j]] = 62208 + j;
		d[62208 + j] = D[243][j];
	}
	D[244] = "����������������������������������������������������������������嚵嚳壣孅巆巇廮廯忀忁懹攗攖攕攓旟曨曣曤櫳櫰櫪櫨櫹櫱櫮櫯瀼瀵瀯瀷瀴瀱灂瀸瀿瀺瀹灀瀻瀳灁爓爔犨獽獼璺皫皪皾盭矌矎矏矍矲礥礣礧礨礤礩����������������������������������禲穮穬穭竷籉籈籊籇籅糮繻繾纁纀羺翿聹臛臙舋艨艩蘢藿蘁藾蘛蘀藶蘄蘉蘅蘌藽蠙蠐蠑蠗蠓蠖襣襦覹觷譠譪譝譨譣譥譧譭趮躆躈躄轙轖轗轕轘轚邍酃酁醷醵醲醳鐋鐓鏻鐠鐏鐔鏾鐕鐐鐨鐙鐍鏵鐀鏷鐇鐎鐖鐒鏺鐉鏸鐊鏿�".split("");
	for (j = 0; j != D[244].length; ++j) if (D[244][j].charCodeAt(0) !== 65533) {
		e[D[244][j]] = 62464 + j;
		d[62464 + j] = D[244][j];
	}
	D[245] = "����������������������������������������������������������������鏼鐌鏶鐑鐆闞闠闟霮霯鞹鞻韽韾顠顢顣顟飁飂饐饎饙饌饋饓騲騴騱騬騪騶騩騮騸騭髇髊髆鬐鬒鬑鰋鰈鯷鰅鰒鯸鱀鰇鰎鰆鰗鰔鰉鶟鶙鶤鶝鶒鶘鶐鶛����������������������������������鶠鶔鶜鶪鶗鶡鶚鶢鶨鶞鶣鶿鶩鶖鶦鶧麙麛麚黥黤黧黦鼰鼮齛齠齞齝齙龑儺儹劘劗囃嚽嚾孈孇巋巏廱懽攛欂櫼欃櫸欀灃灄灊灈灉灅灆爝爚爙獾甗癪矐礭礱礯籔籓糲纊纇纈纋纆纍罍羻耰臝蘘蘪蘦蘟蘣蘜蘙蘧蘮蘡蘠蘩蘞蘥�".split("");
	for (j = 0; j != D[245].length; ++j) if (D[245][j].charCodeAt(0) !== 65533) {
		e[D[245][j]] = 62720 + j;
		d[62720 + j] = D[245][j];
	}
	D[246] = "����������������������������������������������������������������蠩蠝蠛蠠蠤蠜蠫衊襭襩襮襫觺譹譸譅譺譻贐贔趯躎躌轞轛轝酆酄酅醹鐿鐻鐶鐩鐽鐼鐰鐹鐪鐷鐬鑀鐱闥闤闣霵霺鞿韡顤飉飆飀饘饖騹騽驆驄驂驁騺����������������������������������騿髍鬕鬗鬘鬖鬺魒鰫鰝鰜鰬鰣鰨鰩鰤鰡鶷鶶鶼鷁鷇鷊鷏鶾鷅鷃鶻鶵鷎鶹鶺鶬鷈鶱鶭鷌鶳鷍鶲鹺麜黫黮黭鼛鼘鼚鼱齎齥齤龒亹囆囅囋奱孋孌巕巑廲攡攠攦攢欋欈欉氍灕灖灗灒爞爟犩獿瓘瓕瓙瓗癭皭礵禴穰穱籗籜籙籛籚�".split("");
	for (j = 0; j != D[246].length; ++j) if (D[246][j].charCodeAt(0) !== 65533) {
		e[D[246][j]] = 62976 + j;
		d[62976 + j] = D[246][j];
	}
	D[247] = "����������������������������������������������������������������糴糱纑罏羇臞艫蘴蘵蘳蘬蘲蘶蠬蠨蠦蠪蠥襱覿覾觻譾讄讂讆讅譿贕躕躔躚躒躐躖躗轠轢酇鑌鑐鑊鑋鑏鑇鑅鑈鑉鑆霿韣顪顩飋饔饛驎驓驔驌驏驈驊����������������������������������驉驒驐髐鬙鬫鬻魖魕鱆鱈鰿鱄鰹鰳鱁鰼鰷鰴鰲鰽鰶鷛鷒鷞鷚鷋鷐鷜鷑鷟鷩鷙鷘鷖鷵鷕鷝麶黰鼵鼳鼲齂齫龕龢儽劙壨壧奲孍巘蠯彏戁戃戄攩攥斖曫欑欒欏毊灛灚爢玂玁玃癰矔籧籦纕艬蘺虀蘹蘼蘱蘻蘾蠰蠲蠮蠳襶襴襳觾�".split("");
	for (j = 0; j != D[247].length; ++j) if (D[247][j].charCodeAt(0) !== 65533) {
		e[D[247][j]] = 63232 + j;
		d[63232 + j] = D[247][j];
	}
	D[248] = "����������������������������������������������������������������讌讎讋讈豅贙躘轤轣醼鑢鑕鑝鑗鑞韄韅頀驖驙鬞鬟鬠鱒鱘鱐鱊鱍鱋鱕鱙鱌鱎鷻鷷鷯鷣鷫鷸鷤鷶鷡鷮鷦鷲鷰鷢鷬鷴鷳鷨鷭黂黐黲黳鼆鼜鼸鼷鼶齃齏����������������������������������齱齰齮齯囓囍孎屭攭曭曮欓灟灡灝灠爣瓛瓥矕礸禷禶籪纗羉艭虃蠸蠷蠵衋讔讕躞躟躠躝醾醽釂鑫鑨鑩雥靆靃靇韇韥驞髕魙鱣鱧鱦鱢鱞鱠鸂鷾鸇鸃鸆鸅鸀鸁鸉鷿鷽鸄麠鼞齆齴齵齶囔攮斸欘欙欗欚灢爦犪矘矙礹籩籫糶纚�".split("");
	for (j = 0; j != D[248].length; ++j) if (D[248][j].charCodeAt(0) !== 65533) {
		e[D[248][j]] = 63488 + j;
		d[63488 + j] = D[248][j];
	}
	D[249] = "����������������������������������������������������������������纘纛纙臠臡虆虇虈襹襺襼襻觿讘讙躥躤躣鑮鑭鑯鑱鑳靉顲饟鱨鱮鱭鸋鸍鸐鸏鸒鸑麡黵鼉齇齸齻齺齹圞灦籯蠼趲躦釃鑴鑸鑶鑵驠鱴鱳鱱鱵鸔鸓黶鼊����������������������������������龤灨灥糷虪蠾蠽蠿讞貜躩軉靋顳顴飌饡馫驤驦驧鬤鸕鸗齈戇欞爧虌躨钂钀钁驩驨鬮鸙爩虋讟钃鱹麷癵驫鱺鸝灩灪麤齾齉龘碁銹裏墻恒粧嫺╔╦╗╠╬╣╚╩╝╒╤╕╞╪╡╘╧╛╓╥╖╟╫╢╙╨╜║═╭╮╰╯▓�".split("");
	for (j = 0; j != D[249].length; ++j) if (D[249][j].charCodeAt(0) !== 65533) {
		e[D[249][j]] = 63744 + j;
		d[63744 + j] = D[249][j];
	}
	return {
		"enc": e,
		"dec": d
	};
})();
cptable[1250] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€�‚�„…†‡�‰Š‹ŚŤŽŹ�‘’“”•–—�™š›śťžź\xA0ˇ˘Ł¤Ą¦§¨©Ş«¬­®Ż°±˛ł´µ¶·¸ąş»Ľ˝ľżŔÁÂĂÄĹĆÇČÉĘËĚÍÎĎĐŃŇÓÔŐÖ×ŘŮÚŰÜÝŢßŕáâăäĺćçčéęëěíîďđńňóôőö÷řůúűüýţ˙", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[1251] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—�™љ›њќћџ\xA0ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[1252] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€�‚ƒ„…†‡ˆ‰Š‹Œ�Ž��‘’“”•–—˜™š›œ�žŸ\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[1253] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€�‚ƒ„…†‡�‰�‹�����‘’“”•–—�™�›����\xA0΅Ά£¤¥¦§¨©�«¬­®―°±²³΄µ¶·ΈΉΊ»Ό½ΎΏΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡ�ΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώ�", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[1254] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€�‚ƒ„…†‡ˆ‰Š‹Œ����‘’“”•–—˜™š›œ��Ÿ\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏĞÑÒÓÔÕÖ×ØÙÚÛÜİŞßàáâãäåæçèéêëìíîïğñòóôõö÷øùúûüışÿ", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[1255] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€�‚ƒ„…†‡ˆ‰�‹�����‘’“”•–—˜™�›����\xA0¡¢£₪¥¦§¨©×«¬­®¯°±²³´µ¶·¸¹÷»¼½¾¿ְֱֲֳִֵֶַָֹ�ֻּֽ־ֿ׀ׁׂ׃װױײ׳״�������אבגדהוזחטיךכלםמןנסעףפץצקרשת��‎‏�", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[1256] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€پ‚ƒ„…†‡ˆ‰ٹ‹Œچژڈگ‘’“”•–—ک™ڑ›œ‌‍ں\xA0،¢£¤¥¦§¨©ھ«¬­®¯°±²³´µ¶·¸¹؛»¼½¾؟ہءآأؤإئابةتثجحخدذرزسشصض×طظعغـفقكàلâمنهوçèéêëىيîïًٌٍَôُِ÷ّùْûü‎‏ے", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[1257] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€�‚�„…†‡�‰�‹�¨ˇ¸�‘’“”•–—�™�›�¯˛�\xA0�¢£¤�¦§Ø©Ŗ«¬­®Æ°±²³´µ¶·ø¹ŗ»¼½¾æĄĮĀĆÄÅĘĒČÉŹĖĢĶĪĻŠŃŅÓŌÕÖ×ŲŁŚŪÜŻŽßąįāćäåęēčéźėģķīļšńņóōõö÷ųłśūüżž˙", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[1258] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~€�‚ƒ„…†‡ˆ‰�‹Œ����‘’“”•–—˜™�›œ��Ÿ\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂĂÄÅÆÇÈÉÊË̀ÍÎÏĐÑ̉ÓÔƠÖ×ØÙÚÛÜỮßàáâăäåæçèéêë́íîïđṇ̃óôơö÷øùúûüư₫ÿ", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[1e4] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\xA0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄¤‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ�ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[10006] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~Ä¹²É³ÖÜ΅àâä΄¨çéèêë£™îï•½‰ôö¦­ùûü†ΓΔΘΛΞΠß®©ΣΪ§≠°·Α±≤≥¥ΒΕΖΗΙΚΜΦΫΨΩάΝ¬ΟΡ≈Τ«»…\xA0ΥΧΆΈœ–―“”‘’÷ΉΊΌΎέήίόΏύαβψδεφγηιξκλμνοπώρστθωςχυζϊϋΐΰ�", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[10007] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ†°¢£§•¶І®©™Ђђ≠Ѓѓ∞±≤≥іµ∂ЈЄєЇїЉљЊњјЅ¬√ƒ≈∆«»…\xA0ЋћЌќѕ–—“”‘’÷„ЎўЏџ№Ёёяабвгдежзийклмнопрстуфхцчшщъыьэю¤", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[10008] = (function() {
	var d = [], e = {}, D = [], j;
	D[0] = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~���������������������������������������������������������������������������������������".split("");
	for (j = 0; j != D[0].length; ++j) if (D[0][j].charCodeAt(0) !== 65533) {
		e[D[0][j]] = 0 + j;
		d[0 + j] = D[0][j];
	}
	D[161] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������　、。・ˉˇ¨〃々―～�…‘’“”〔〕〈〉《》「」『』〖〗【】±×÷∶∧∨∑∏∪∩∈∷√⊥∥∠⌒⊙∫∮≡≌≈∽∝≠≮≯≤≥∞∵∴♂♀°′″℃＄¤￠￡‰§№☆★○●◎◇◆□■△▲※→←↑↓〓�".split("");
	for (j = 0; j != D[161].length; ++j) if (D[161][j].charCodeAt(0) !== 65533) {
		e[D[161][j]] = 41216 + j;
		d[41216 + j] = D[161][j];
	}
	D[162] = "���������������������������������������������������������������������������������������������������������������������������������������������������������������������������������⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑⒒⒓⒔⒕⒖⒗⒘⒙⒚⒛⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇①②③④⑤⑥⑦⑧⑨⑩��㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩��ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ���".split("");
	for (j = 0; j != D[162].length; ++j) if (D[162][j].charCodeAt(0) !== 65533) {
		e[D[162][j]] = 41472 + j;
		d[41472 + j] = D[162][j];
	}
	D[163] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������！＂＃￥％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝￣�".split("");
	for (j = 0; j != D[163].length; ++j) if (D[163][j].charCodeAt(0) !== 65533) {
		e[D[163][j]] = 41728 + j;
		d[41728 + j] = D[163][j];
	}
	D[164] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをん������������".split("");
	for (j = 0; j != D[164].length; ++j) if (D[164][j].charCodeAt(0) !== 65533) {
		e[D[164][j]] = 41984 + j;
		d[41984 + j] = D[164][j];
	}
	D[165] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ���������".split("");
	for (j = 0; j != D[165].length; ++j) if (D[165][j].charCodeAt(0) !== 65533) {
		e[D[165][j]] = 42240 + j;
		d[42240 + j] = D[165][j];
	}
	D[166] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ��������αβγδεζηθικλμνξοπρστυφχψω���������������������������������������".split("");
	for (j = 0; j != D[166].length; ++j) if (D[166][j].charCodeAt(0) !== 65533) {
		e[D[166][j]] = 42496 + j;
		d[42496 + j] = D[166][j];
	}
	D[167] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ���������������абвгдеёжзийклмнопрстуфхцчшщъыьэюя��������������".split("");
	for (j = 0; j != D[167].length; ++j) if (D[167][j].charCodeAt(0) !== 65533) {
		e[D[167][j]] = 42752 + j;
		d[42752 + j] = D[167][j];
	}
	D[168] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüê����������ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ����������������������".split("");
	for (j = 0; j != D[168].length; ++j) if (D[168][j].charCodeAt(0) !== 65533) {
		e[D[168][j]] = 43008 + j;
		d[43008 + j] = D[168][j];
	}
	D[169] = "��������������������������������������������������������������������������������������������������������������������������������������������������������������������─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃╄╅╆╇╈╉╊╋����������������".split("");
	for (j = 0; j != D[169].length; ++j) if (D[169][j].charCodeAt(0) !== 65533) {
		e[D[169][j]] = 43264 + j;
		d[43264 + j] = D[169][j];
	}
	D[176] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������啊阿埃挨哎唉哀皑癌蔼矮艾碍爱隘鞍氨安俺按暗岸胺案肮昂盎凹敖熬翱袄傲奥懊澳芭捌扒叭吧笆八疤巴拔跋靶把耙坝霸罢爸白柏百摆佰败拜稗斑班搬扳般颁板版扮拌伴瓣半办绊邦帮梆榜膀绑棒磅蚌镑傍谤苞胞包褒剥�".split("");
	for (j = 0; j != D[176].length; ++j) if (D[176][j].charCodeAt(0) !== 65533) {
		e[D[176][j]] = 45056 + j;
		d[45056 + j] = D[176][j];
	}
	D[177] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������薄雹保堡饱宝抱报暴豹鲍爆杯碑悲卑北辈背贝钡倍狈备惫焙被奔苯本笨崩绷甭泵蹦迸逼鼻比鄙笔彼碧蓖蔽毕毙毖币庇痹闭敝弊必辟壁臂避陛鞭边编贬扁便变卞辨辩辫遍标彪膘表鳖憋别瘪彬斌濒滨宾摈兵冰柄丙秉饼炳�".split("");
	for (j = 0; j != D[177].length; ++j) if (D[177][j].charCodeAt(0) !== 65533) {
		e[D[177][j]] = 45312 + j;
		d[45312 + j] = D[177][j];
	}
	D[178] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������病并玻菠播拨钵波博勃搏铂箔伯帛舶脖膊渤泊驳捕卜哺补埠不布步簿部怖擦猜裁材才财睬踩采彩菜蔡餐参蚕残惭惨灿苍舱仓沧藏操糙槽曹草厕策侧册测层蹭插叉茬茶查碴搽察岔差诧拆柴豺搀掺蝉馋谗缠铲产阐颤昌猖�".split("");
	for (j = 0; j != D[178].length; ++j) if (D[178][j].charCodeAt(0) !== 65533) {
		e[D[178][j]] = 45568 + j;
		d[45568 + j] = D[178][j];
	}
	D[179] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������场尝常长偿肠厂敞畅唱倡超抄钞朝嘲潮巢吵炒车扯撤掣彻澈郴臣辰尘晨忱沉陈趁衬撑称城橙成呈乘程惩澄诚承逞骋秤吃痴持匙池迟弛驰耻齿侈尺赤翅斥炽充冲虫崇宠抽酬畴踌稠愁筹仇绸瞅丑臭初出橱厨躇锄雏滁除楚�".split("");
	for (j = 0; j != D[179].length; ++j) if (D[179][j].charCodeAt(0) !== 65533) {
		e[D[179][j]] = 45824 + j;
		d[45824 + j] = D[179][j];
	}
	D[180] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������础储矗搐触处揣川穿椽传船喘串疮窗幢床闯创吹炊捶锤垂春椿醇唇淳纯蠢戳绰疵茨磁雌辞慈瓷词此刺赐次聪葱囱匆从丛凑粗醋簇促蹿篡窜摧崔催脆瘁粹淬翠村存寸磋撮搓措挫错搭达答瘩打大呆歹傣戴带殆代贷袋待逮�".split("");
	for (j = 0; j != D[180].length; ++j) if (D[180][j].charCodeAt(0) !== 65533) {
		e[D[180][j]] = 46080 + j;
		d[46080 + j] = D[180][j];
	}
	D[181] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������怠耽担丹单郸掸胆旦氮但惮淡诞弹蛋当挡党荡档刀捣蹈倒岛祷导到稻悼道盗德得的蹬灯登等瞪凳邓堤低滴迪敌笛狄涤翟嫡抵底地蒂第帝弟递缔颠掂滇碘点典靛垫电佃甸店惦奠淀殿碉叼雕凋刁掉吊钓调跌爹碟蝶迭谍叠�".split("");
	for (j = 0; j != D[181].length; ++j) if (D[181][j].charCodeAt(0) !== 65533) {
		e[D[181][j]] = 46336 + j;
		d[46336 + j] = D[181][j];
	}
	D[182] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������丁盯叮钉顶鼎锭定订丢东冬董懂动栋侗恫冻洞兜抖斗陡豆逗痘都督毒犊独读堵睹赌杜镀肚度渡妒端短锻段断缎堆兑队对墩吨蹲敦顿囤钝盾遁掇哆多夺垛躲朵跺舵剁惰堕蛾峨鹅俄额讹娥恶厄扼遏鄂饿恩而儿耳尔饵洱二�".split("");
	for (j = 0; j != D[182].length; ++j) if (D[182][j].charCodeAt(0) !== 65533) {
		e[D[182][j]] = 46592 + j;
		d[46592 + j] = D[182][j];
	}
	D[183] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������贰发罚筏伐乏阀法珐藩帆番翻樊矾钒繁凡烦反返范贩犯饭泛坊芳方肪房防妨仿访纺放菲非啡飞肥匪诽吠肺废沸费芬酚吩氛分纷坟焚汾粉奋份忿愤粪丰封枫蜂峰锋风疯烽逢冯缝讽奉凤佛否夫敷肤孵扶拂辐幅氟符伏俘服�".split("");
	for (j = 0; j != D[183].length; ++j) if (D[183][j].charCodeAt(0) !== 65533) {
		e[D[183][j]] = 46848 + j;
		d[46848 + j] = D[183][j];
	}
	D[184] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������浮涪福袱弗甫抚辅俯釜斧脯腑府腐赴副覆赋复傅付阜父腹负富讣附妇缚咐噶嘎该改概钙盖溉干甘杆柑竿肝赶感秆敢赣冈刚钢缸肛纲岗港杠篙皋高膏羔糕搞镐稿告哥歌搁戈鸽胳疙割革葛格蛤阁隔铬个各给根跟耕更庚羹�".split("");
	for (j = 0; j != D[184].length; ++j) if (D[184][j].charCodeAt(0) !== 65533) {
		e[D[184][j]] = 47104 + j;
		d[47104 + j] = D[184][j];
	}
	D[185] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������埂耿梗工攻功恭龚供躬公宫弓巩汞拱贡共钩勾沟苟狗垢构购够辜菇咕箍估沽孤姑鼓古蛊骨谷股故顾固雇刮瓜剐寡挂褂乖拐怪棺关官冠观管馆罐惯灌贯光广逛瑰规圭硅归龟闺轨鬼诡癸桂柜跪贵刽辊滚棍锅郭国果裹过哈�".split("");
	for (j = 0; j != D[185].length; ++j) if (D[185][j].charCodeAt(0) !== 65533) {
		e[D[185][j]] = 47360 + j;
		d[47360 + j] = D[185][j];
	}
	D[186] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������骸孩海氦亥害骇酣憨邯韩含涵寒函喊罕翰撼捍旱憾悍焊汗汉夯杭航壕嚎豪毫郝好耗号浩呵喝荷菏核禾和何合盒貉阂河涸赫褐鹤贺嘿黑痕很狠恨哼亨横衡恒轰哄烘虹鸿洪宏弘红喉侯猴吼厚候后呼乎忽瑚壶葫胡蝴狐糊湖�".split("");
	for (j = 0; j != D[186].length; ++j) if (D[186][j].charCodeAt(0) !== 65533) {
		e[D[186][j]] = 47616 + j;
		d[47616 + j] = D[186][j];
	}
	D[187] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������弧虎唬护互沪户花哗华猾滑画划化话槐徊怀淮坏欢环桓还缓换患唤痪豢焕涣宦幻荒慌黄磺蝗簧皇凰惶煌晃幌恍谎灰挥辉徽恢蛔回毁悔慧卉惠晦贿秽会烩汇讳诲绘荤昏婚魂浑混豁活伙火获或惑霍货祸击圾基机畸稽积箕�".split("");
	for (j = 0; j != D[187].length; ++j) if (D[187][j].charCodeAt(0) !== 65533) {
		e[D[187][j]] = 47872 + j;
		d[47872 + j] = D[187][j];
	}
	D[188] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������肌饥迹激讥鸡姬绩缉吉极棘辑籍集及急疾汲即嫉级挤几脊己蓟技冀季伎祭剂悸济寄寂计记既忌际妓继纪嘉枷夹佳家加荚颊贾甲钾假稼价架驾嫁歼监坚尖笺间煎兼肩艰奸缄茧检柬碱硷拣捡简俭剪减荐槛鉴践贱见键箭件�".split("");
	for (j = 0; j != D[188].length; ++j) if (D[188][j].charCodeAt(0) !== 65533) {
		e[D[188][j]] = 48128 + j;
		d[48128 + j] = D[188][j];
	}
	D[189] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������健舰剑饯渐溅涧建僵姜将浆江疆蒋桨奖讲匠酱降蕉椒礁焦胶交郊浇骄娇嚼搅铰矫侥脚狡角饺缴绞剿教酵轿较叫窖揭接皆秸街阶截劫节桔杰捷睫竭洁结解姐戒藉芥界借介疥诫届巾筋斤金今津襟紧锦仅谨进靳晋禁近烬浸�".split("");
	for (j = 0; j != D[189].length; ++j) if (D[189][j].charCodeAt(0) !== 65533) {
		e[D[189][j]] = 48384 + j;
		d[48384 + j] = D[189][j];
	}
	D[190] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������尽劲荆兢茎睛晶鲸京惊精粳经井警景颈静境敬镜径痉靖竟竞净炯窘揪究纠玖韭久灸九酒厩救旧臼舅咎就疚鞠拘狙疽居驹菊局咀矩举沮聚拒据巨具距踞锯俱句惧炬剧捐鹃娟倦眷卷绢撅攫抉掘倔爵觉决诀绝均菌钧军君峻�".split("");
	for (j = 0; j != D[190].length; ++j) if (D[190][j].charCodeAt(0) !== 65533) {
		e[D[190][j]] = 48640 + j;
		d[48640 + j] = D[190][j];
	}
	D[191] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������俊竣浚郡骏喀咖卡咯开揩楷凯慨刊堪勘坎砍看康慷糠扛抗亢炕考拷烤靠坷苛柯棵磕颗科壳咳可渴克刻客课肯啃垦恳坑吭空恐孔控抠口扣寇枯哭窟苦酷库裤夸垮挎跨胯块筷侩快宽款匡筐狂框矿眶旷况亏盔岿窥葵奎魁傀�".split("");
	for (j = 0; j != D[191].length; ++j) if (D[191][j].charCodeAt(0) !== 65533) {
		e[D[191][j]] = 48896 + j;
		d[48896 + j] = D[191][j];
	}
	D[192] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������馈愧溃坤昆捆困括扩廓阔垃拉喇蜡腊辣啦莱来赖蓝婪栏拦篮阑兰澜谰揽览懒缆烂滥琅榔狼廊郎朗浪捞劳牢老佬姥酪烙涝勒乐雷镭蕾磊累儡垒擂肋类泪棱楞冷厘梨犁黎篱狸离漓理李里鲤礼莉荔吏栗丽厉励砾历利傈例俐�".split("");
	for (j = 0; j != D[192].length; ++j) if (D[192][j].charCodeAt(0) !== 65533) {
		e[D[192][j]] = 49152 + j;
		d[49152 + j] = D[192][j];
	}
	D[193] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������痢立粒沥隶力璃哩俩联莲连镰廉怜涟帘敛脸链恋炼练粮凉梁粱良两辆量晾亮谅撩聊僚疗燎寥辽潦了撂镣廖料列裂烈劣猎琳林磷霖临邻鳞淋凛赁吝拎玲菱零龄铃伶羚凌灵陵岭领另令溜琉榴硫馏留刘瘤流柳六龙聋咙笼窿�".split("");
	for (j = 0; j != D[193].length; ++j) if (D[193][j].charCodeAt(0) !== 65533) {
		e[D[193][j]] = 49408 + j;
		d[49408 + j] = D[193][j];
	}
	D[194] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������隆垄拢陇楼娄搂篓漏陋芦卢颅庐炉掳卤虏鲁麓碌露路赂鹿潞禄录陆戮驴吕铝侣旅履屡缕虑氯律率滤绿峦挛孪滦卵乱掠略抡轮伦仑沦纶论萝螺罗逻锣箩骡裸落洛骆络妈麻玛码蚂马骂嘛吗埋买麦卖迈脉瞒馒蛮满蔓曼慢漫�".split("");
	for (j = 0; j != D[194].length; ++j) if (D[194][j].charCodeAt(0) !== 65533) {
		e[D[194][j]] = 49664 + j;
		d[49664 + j] = D[194][j];
	}
	D[195] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������谩芒茫盲氓忙莽猫茅锚毛矛铆卯茂冒帽貌贸么玫枚梅酶霉煤没眉媒镁每美昧寐妹媚门闷们萌蒙檬盟锰猛梦孟眯醚靡糜迷谜弥米秘觅泌蜜密幂棉眠绵冕免勉娩缅面苗描瞄藐秒渺庙妙蔑灭民抿皿敏悯闽明螟鸣铭名命谬摸�".split("");
	for (j = 0; j != D[195].length; ++j) if (D[195][j].charCodeAt(0) !== 65533) {
		e[D[195][j]] = 49920 + j;
		d[49920 + j] = D[195][j];
	}
	D[196] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������摹蘑模膜磨摩魔抹末莫墨默沫漠寞陌谋牟某拇牡亩姆母墓暮幕募慕木目睦牧穆拿哪呐钠那娜纳氖乃奶耐奈南男难囊挠脑恼闹淖呢馁内嫩能妮霓倪泥尼拟你匿腻逆溺蔫拈年碾撵捻念娘酿鸟尿捏聂孽啮镊镍涅您柠狞凝宁�".split("");
	for (j = 0; j != D[196].length; ++j) if (D[196][j].charCodeAt(0) !== 65533) {
		e[D[196][j]] = 50176 + j;
		d[50176 + j] = D[196][j];
	}
	D[197] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������拧泞牛扭钮纽脓浓农弄奴努怒女暖虐疟挪懦糯诺哦欧鸥殴藕呕偶沤啪趴爬帕怕琶拍排牌徘湃派攀潘盘磐盼畔判叛乓庞旁耪胖抛咆刨炮袍跑泡呸胚培裴赔陪配佩沛喷盆砰抨烹澎彭蓬棚硼篷膨朋鹏捧碰坯砒霹批披劈琵毗�".split("");
	for (j = 0; j != D[197].length; ++j) if (D[197][j].charCodeAt(0) !== 65533) {
		e[D[197][j]] = 50432 + j;
		d[50432 + j] = D[197][j];
	}
	D[198] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������啤脾疲皮匹痞僻屁譬篇偏片骗飘漂瓢票撇瞥拼频贫品聘乒坪苹萍平凭瓶评屏坡泼颇婆破魄迫粕剖扑铺仆莆葡菩蒲埔朴圃普浦谱曝瀑期欺栖戚妻七凄漆柒沏其棋奇歧畦崎脐齐旗祈祁骑起岂乞企启契砌器气迄弃汽泣讫掐�".split("");
	for (j = 0; j != D[198].length; ++j) if (D[198][j].charCodeAt(0) !== 65533) {
		e[D[198][j]] = 50688 + j;
		d[50688 + j] = D[198][j];
	}
	D[199] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������恰洽牵扦钎铅千迁签仟谦乾黔钱钳前潜遣浅谴堑嵌欠歉枪呛腔羌墙蔷强抢橇锹敲悄桥瞧乔侨巧鞘撬翘峭俏窍切茄且怯窃钦侵亲秦琴勤芹擒禽寝沁青轻氢倾卿清擎晴氰情顷请庆琼穷秋丘邱球求囚酋泅趋区蛆曲躯屈驱渠�".split("");
	for (j = 0; j != D[199].length; ++j) if (D[199][j].charCodeAt(0) !== 65533) {
		e[D[199][j]] = 50944 + j;
		d[50944 + j] = D[199][j];
	}
	D[200] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������取娶龋趣去圈颧权醛泉全痊拳犬券劝缺炔瘸却鹊榷确雀裙群然燃冉染瓤壤攘嚷让饶扰绕惹热壬仁人忍韧任认刃妊纫扔仍日戎茸蓉荣融熔溶容绒冗揉柔肉茹蠕儒孺如辱乳汝入褥软阮蕊瑞锐闰润若弱撒洒萨腮鳃塞赛三叁�".split("");
	for (j = 0; j != D[200].length; ++j) if (D[200][j].charCodeAt(0) !== 65533) {
		e[D[200][j]] = 51200 + j;
		d[51200 + j] = D[200][j];
	}
	D[201] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������伞散桑嗓丧搔骚扫嫂瑟色涩森僧莎砂杀刹沙纱傻啥煞筛晒珊苫杉山删煽衫闪陕擅赡膳善汕扇缮墒伤商赏晌上尚裳梢捎稍烧芍勺韶少哨邵绍奢赊蛇舌舍赦摄射慑涉社设砷申呻伸身深娠绅神沈审婶甚肾慎渗声生甥牲升绳�".split("");
	for (j = 0; j != D[201].length; ++j) if (D[201][j].charCodeAt(0) !== 65533) {
		e[D[201][j]] = 51456 + j;
		d[51456 + j] = D[201][j];
	}
	D[202] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������省盛剩胜圣师失狮施湿诗尸虱十石拾时什食蚀实识史矢使屎驶始式示士世柿事拭誓逝势是嗜噬适仕侍释饰氏市恃室视试收手首守寿授售受瘦兽蔬枢梳殊抒输叔舒淑疏书赎孰熟薯暑曙署蜀黍鼠属术述树束戍竖墅庶数漱�".split("");
	for (j = 0; j != D[202].length; ++j) if (D[202][j].charCodeAt(0) !== 65533) {
		e[D[202][j]] = 51712 + j;
		d[51712 + j] = D[202][j];
	}
	D[203] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������恕刷耍摔衰甩帅栓拴霜双爽谁水睡税吮瞬顺舜说硕朔烁斯撕嘶思私司丝死肆寺嗣四伺似饲巳松耸怂颂送宋讼诵搜艘擞嗽苏酥俗素速粟僳塑溯宿诉肃酸蒜算虽隋随绥髓碎岁穗遂隧祟孙损笋蓑梭唆缩琐索锁所塌他它她塔�".split("");
	for (j = 0; j != D[203].length; ++j) if (D[203][j].charCodeAt(0) !== 65533) {
		e[D[203][j]] = 51968 + j;
		d[51968 + j] = D[203][j];
	}
	D[204] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������獭挞蹋踏胎苔抬台泰酞太态汰坍摊贪瘫滩坛檀痰潭谭谈坦毯袒碳探叹炭汤塘搪堂棠膛唐糖倘躺淌趟烫掏涛滔绦萄桃逃淘陶讨套特藤腾疼誊梯剔踢锑提题蹄啼体替嚏惕涕剃屉天添填田甜恬舔腆挑条迢眺跳贴铁帖厅听烃�".split("");
	for (j = 0; j != D[204].length; ++j) if (D[204][j].charCodeAt(0) !== 65533) {
		e[D[204][j]] = 52224 + j;
		d[52224 + j] = D[204][j];
	}
	D[205] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������汀廷停亭庭挺艇通桐酮瞳同铜彤童桶捅筒统痛偷投头透凸秃突图徒途涂屠土吐兔湍团推颓腿蜕褪退吞屯臀拖托脱鸵陀驮驼椭妥拓唾挖哇蛙洼娃瓦袜歪外豌弯湾玩顽丸烷完碗挽晚皖惋宛婉万腕汪王亡枉网往旺望忘妄威�".split("");
	for (j = 0; j != D[205].length; ++j) if (D[205][j].charCodeAt(0) !== 65533) {
		e[D[205][j]] = 52480 + j;
		d[52480 + j] = D[205][j];
	}
	D[206] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������巍微危韦违桅围唯惟为潍维苇萎委伟伪尾纬未蔚味畏胃喂魏位渭谓尉慰卫瘟温蚊文闻纹吻稳紊问嗡翁瓮挝蜗涡窝我斡卧握沃巫呜钨乌污诬屋无芜梧吾吴毋武五捂午舞伍侮坞戊雾晤物勿务悟误昔熙析西硒矽晰嘻吸锡牺�".split("");
	for (j = 0; j != D[206].length; ++j) if (D[206][j].charCodeAt(0) !== 65533) {
		e[D[206][j]] = 52736 + j;
		d[52736 + j] = D[206][j];
	}
	D[207] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������稀息希悉膝夕惜熄烯溪汐犀檄袭席习媳喜铣洗系隙戏细瞎虾匣霞辖暇峡侠狭下厦夏吓掀锨先仙鲜纤咸贤衔舷闲涎弦嫌显险现献县腺馅羡宪陷限线相厢镶香箱襄湘乡翔祥详想响享项巷橡像向象萧硝霄削哮嚣销消宵淆晓�".split("");
	for (j = 0; j != D[207].length; ++j) if (D[207][j].charCodeAt(0) !== 65533) {
		e[D[207][j]] = 52992 + j;
		d[52992 + j] = D[207][j];
	}
	D[208] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������小孝校肖啸笑效楔些歇蝎鞋协挟携邪斜胁谐写械卸蟹懈泄泻谢屑薪芯锌欣辛新忻心信衅星腥猩惺兴刑型形邢行醒幸杏性姓兄凶胸匈汹雄熊休修羞朽嗅锈秀袖绣墟戌需虚嘘须徐许蓄酗叙旭序畜恤絮婿绪续轩喧宣悬旋玄�".split("");
	for (j = 0; j != D[208].length; ++j) if (D[208][j].charCodeAt(0) !== 65533) {
		e[D[208][j]] = 53248 + j;
		d[53248 + j] = D[208][j];
	}
	D[209] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������选癣眩绚靴薛学穴雪血勋熏循旬询寻驯巡殉汛训讯逊迅压押鸦鸭呀丫芽牙蚜崖衙涯雅哑亚讶焉咽阉烟淹盐严研蜒岩延言颜阎炎沿奄掩眼衍演艳堰燕厌砚雁唁彦焰宴谚验殃央鸯秧杨扬佯疡羊洋阳氧仰痒养样漾邀腰妖瑶�".split("");
	for (j = 0; j != D[209].length; ++j) if (D[209][j].charCodeAt(0) !== 65533) {
		e[D[209][j]] = 53504 + j;
		d[53504 + j] = D[209][j];
	}
	D[210] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������摇尧遥窑谣姚咬舀药要耀椰噎耶爷野冶也页掖业叶曳腋夜液一壹医揖铱依伊衣颐夷遗移仪胰疑沂宜姨彝椅蚁倚已乙矣以艺抑易邑屹亿役臆逸肄疫亦裔意毅忆义益溢诣议谊译异翼翌绎茵荫因殷音阴姻吟银淫寅饮尹引隐�".split("");
	for (j = 0; j != D[210].length; ++j) if (D[210][j].charCodeAt(0) !== 65533) {
		e[D[210][j]] = 53760 + j;
		d[53760 + j] = D[210][j];
	}
	D[211] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������印英樱婴鹰应缨莹萤营荧蝇迎赢盈影颖硬映哟拥佣臃痈庸雍踊蛹咏泳涌永恿勇用幽优悠忧尤由邮铀犹油游酉有友右佑釉诱又幼迂淤于盂榆虞愚舆余俞逾鱼愉渝渔隅予娱雨与屿禹宇语羽玉域芋郁吁遇喻峪御愈欲狱育誉�".split("");
	for (j = 0; j != D[211].length; ++j) if (D[211][j].charCodeAt(0) !== 65533) {
		e[D[211][j]] = 54016 + j;
		d[54016 + j] = D[211][j];
	}
	D[212] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������浴寓裕预豫驭鸳渊冤元垣袁原援辕园员圆猿源缘远苑愿怨院曰约越跃钥岳粤月悦阅耘云郧匀陨允运蕴酝晕韵孕匝砸杂栽哉灾宰载再在咱攒暂赞赃脏葬遭糟凿藻枣早澡蚤躁噪造皂灶燥责择则泽贼怎增憎曾赠扎喳渣札轧�".split("");
	for (j = 0; j != D[212].length; ++j) if (D[212][j].charCodeAt(0) !== 65533) {
		e[D[212][j]] = 54272 + j;
		d[54272 + j] = D[212][j];
	}
	D[213] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������铡闸眨栅榨咋乍炸诈摘斋宅窄债寨瞻毡詹粘沾盏斩辗崭展蘸栈占战站湛绽樟章彰漳张掌涨杖丈帐账仗胀瘴障招昭找沼赵照罩兆肇召遮折哲蛰辙者锗蔗这浙珍斟真甄砧臻贞针侦枕疹诊震振镇阵蒸挣睁征狰争怔整拯正政�".split("");
	for (j = 0; j != D[213].length; ++j) if (D[213][j].charCodeAt(0) !== 65533) {
		e[D[213][j]] = 54528 + j;
		d[54528 + j] = D[213][j];
	}
	D[214] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������帧症郑证芝枝支吱蜘知肢脂汁之织职直植殖执值侄址指止趾只旨纸志挚掷至致置帜峙制智秩稚质炙痔滞治窒中盅忠钟衷终种肿重仲众舟周州洲诌粥轴肘帚咒皱宙昼骤珠株蛛朱猪诸诛逐竹烛煮拄瞩嘱主著柱助蛀贮铸筑�".split("");
	for (j = 0; j != D[214].length; ++j) if (D[214][j].charCodeAt(0) !== 65533) {
		e[D[214][j]] = 54784 + j;
		d[54784 + j] = D[214][j];
	}
	D[215] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������住注祝驻抓爪拽专砖转撰赚篆桩庄装妆撞壮状椎锥追赘坠缀谆准捉拙卓桌琢茁酌啄着灼浊兹咨资姿滋淄孜紫仔籽滓子自渍字鬃棕踪宗综总纵邹走奏揍租足卒族祖诅阻组钻纂嘴醉最罪尊遵昨左佐柞做作坐座������".split("");
	for (j = 0; j != D[215].length; ++j) if (D[215][j].charCodeAt(0) !== 65533) {
		e[D[215][j]] = 55040 + j;
		d[55040 + j] = D[215][j];
	}
	D[216] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������亍丌兀丐廿卅丕亘丞鬲孬噩丨禺丿匕乇夭爻卮氐囟胤馗毓睾鼗丶亟鼐乜乩亓芈孛啬嘏仄厍厝厣厥厮靥赝匚叵匦匮匾赜卦卣刂刈刎刭刳刿剀剌剞剡剜蒯剽劂劁劐劓冂罔亻仃仉仂仨仡仫仞伛仳伢佤仵伥伧伉伫佞佧攸佚佝�".split("");
	for (j = 0; j != D[216].length; ++j) if (D[216][j].charCodeAt(0) !== 65533) {
		e[D[216][j]] = 55296 + j;
		d[55296 + j] = D[216][j];
	}
	D[217] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������佟佗伲伽佶佴侑侉侃侏佾佻侪佼侬侔俦俨俪俅俚俣俜俑俟俸倩偌俳倬倏倮倭俾倜倌倥倨偾偃偕偈偎偬偻傥傧傩傺僖儆僭僬僦僮儇儋仝氽佘佥俎龠汆籴兮巽黉馘冁夔勹匍訇匐凫夙兕亠兖亳衮袤亵脔裒禀嬴蠃羸冫冱冽冼�".split("");
	for (j = 0; j != D[217].length; ++j) if (D[217][j].charCodeAt(0) !== 65533) {
		e[D[217][j]] = 55552 + j;
		d[55552 + j] = D[217][j];
	}
	D[218] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������凇冖冢冥讠讦讧讪讴讵讷诂诃诋诏诎诒诓诔诖诘诙诜诟诠诤诨诩诮诰诳诶诹诼诿谀谂谄谇谌谏谑谒谔谕谖谙谛谘谝谟谠谡谥谧谪谫谮谯谲谳谵谶卩卺阝阢阡阱阪阽阼陂陉陔陟陧陬陲陴隈隍隗隰邗邛邝邙邬邡邴邳邶邺�".split("");
	for (j = 0; j != D[218].length; ++j) if (D[218][j].charCodeAt(0) !== 65533) {
		e[D[218][j]] = 55808 + j;
		d[55808 + j] = D[218][j];
	}
	D[219] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������邸邰郏郅邾郐郄郇郓郦郢郜郗郛郫郯郾鄄鄢鄞鄣鄱鄯鄹酃酆刍奂劢劬劭劾哿勐勖勰叟燮矍廴凵凼鬯厶弁畚巯坌垩垡塾墼壅壑圩圬圪圳圹圮圯坜圻坂坩垅坫垆坼坻坨坭坶坳垭垤垌垲埏垧垴垓垠埕埘埚埙埒垸埴埯埸埤埝�".split("");
	for (j = 0; j != D[219].length; ++j) if (D[219][j].charCodeAt(0) !== 65533) {
		e[D[219][j]] = 56064 + j;
		d[56064 + j] = D[219][j];
	}
	D[220] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������堋堍埽埭堀堞堙塄堠塥塬墁墉墚墀馨鼙懿艹艽艿芏芊芨芄芎芑芗芙芫芸芾芰苈苊苣芘芷芮苋苌苁芩芴芡芪芟苄苎芤苡茉苷苤茏茇苜苴苒苘茌苻苓茑茚茆茔茕苠苕茜荑荛荜茈莒茼茴茱莛荞茯荏荇荃荟荀茗荠茭茺茳荦荥�".split("");
	for (j = 0; j != D[220].length; ++j) if (D[220][j].charCodeAt(0) !== 65533) {
		e[D[220][j]] = 56320 + j;
		d[56320 + j] = D[220][j];
	}
	D[221] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������荨茛荩荬荪荭荮莰荸莳莴莠莪莓莜莅荼莶莩荽莸荻莘莞莨莺莼菁萁菥菘堇萘萋菝菽菖萜萸萑萆菔菟萏萃菸菹菪菅菀萦菰菡葜葑葚葙葳蒇蒈葺蒉葸萼葆葩葶蒌蒎萱葭蓁蓍蓐蓦蒽蓓蓊蒿蒺蓠蒡蒹蒴蒗蓥蓣蔌甍蔸蓰蔹蔟蔺�".split("");
	for (j = 0; j != D[221].length; ++j) if (D[221][j].charCodeAt(0) !== 65533) {
		e[D[221][j]] = 56576 + j;
		d[56576 + j] = D[221][j];
	}
	D[222] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������蕖蔻蓿蓼蕙蕈蕨蕤蕞蕺瞢蕃蕲蕻薤薨薇薏蕹薮薜薅薹薷薰藓藁藜藿蘧蘅蘩蘖蘼廾弈夼奁耷奕奚奘匏尢尥尬尴扌扪抟抻拊拚拗拮挢拶挹捋捃掭揶捱捺掎掴捭掬掊捩掮掼揲揸揠揿揄揞揎摒揆掾摅摁搋搛搠搌搦搡摞撄摭撖�".split("");
	for (j = 0; j != D[222].length; ++j) if (D[222][j].charCodeAt(0) !== 65533) {
		e[D[222][j]] = 56832 + j;
		d[56832 + j] = D[222][j];
	}
	D[223] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������摺撷撸撙撺擀擐擗擤擢攉攥攮弋忒甙弑卟叱叽叩叨叻吒吖吆呋呒呓呔呖呃吡呗呙吣吲咂咔呷呱呤咚咛咄呶呦咝哐咭哂咴哒咧咦哓哔呲咣哕咻咿哌哙哚哜咩咪咤哝哏哞唛哧唠哽唔哳唢唣唏唑唧唪啧喏喵啉啭啁啕唿啐唼�".split("");
	for (j = 0; j != D[223].length; ++j) if (D[223][j].charCodeAt(0) !== 65533) {
		e[D[223][j]] = 57088 + j;
		d[57088 + j] = D[223][j];
	}
	D[224] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������唷啖啵啶啷唳唰啜喋嗒喃喱喹喈喁喟啾嗖喑啻嗟喽喾喔喙嗪嗷嗉嘟嗑嗫嗬嗔嗦嗝嗄嗯嗥嗲嗳嗌嗍嗨嗵嗤辔嘞嘈嘌嘁嘤嘣嗾嘀嘧嘭噘嘹噗嘬噍噢噙噜噌噔嚆噤噱噫噻噼嚅嚓嚯囔囗囝囡囵囫囹囿圄圊圉圜帏帙帔帑帱帻帼�".split("");
	for (j = 0; j != D[224].length; ++j) if (D[224][j].charCodeAt(0) !== 65533) {
		e[D[224][j]] = 57344 + j;
		d[57344 + j] = D[224][j];
	}
	D[225] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������帷幄幔幛幞幡岌屺岍岐岖岈岘岙岑岚岜岵岢岽岬岫岱岣峁岷峄峒峤峋峥崂崃崧崦崮崤崞崆崛嵘崾崴崽嵬嵛嵯嵝嵫嵋嵊嵩嵴嶂嶙嶝豳嶷巅彳彷徂徇徉後徕徙徜徨徭徵徼衢彡犭犰犴犷犸狃狁狎狍狒狨狯狩狲狴狷猁狳猃狺�".split("");
	for (j = 0; j != D[225].length; ++j) if (D[225][j].charCodeAt(0) !== 65533) {
		e[D[225][j]] = 57600 + j;
		d[57600 + j] = D[225][j];
	}
	D[226] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������狻猗猓猡猊猞猝猕猢猹猥猬猸猱獐獍獗獠獬獯獾舛夥飧夤夂饣饧饨饩饪饫饬饴饷饽馀馄馇馊馍馐馑馓馔馕庀庑庋庖庥庠庹庵庾庳赓廒廑廛廨廪膺忄忉忖忏怃忮怄忡忤忾怅怆忪忭忸怙怵怦怛怏怍怩怫怊怿怡恸恹恻恺恂�".split("");
	for (j = 0; j != D[226].length; ++j) if (D[226][j].charCodeAt(0) !== 65533) {
		e[D[226][j]] = 57856 + j;
		d[57856 + j] = D[226][j];
	}
	D[227] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������恪恽悖悚悭悝悃悒悌悛惬悻悱惝惘惆惚悴愠愦愕愣惴愀愎愫慊慵憬憔憧憷懔懵忝隳闩闫闱闳闵闶闼闾阃阄阆阈阊阋阌阍阏阒阕阖阗阙阚丬爿戕氵汔汜汊沣沅沐沔沌汨汩汴汶沆沩泐泔沭泷泸泱泗沲泠泖泺泫泮沱泓泯泾�".split("");
	for (j = 0; j != D[227].length; ++j) if (D[227][j].charCodeAt(0) !== 65533) {
		e[D[227][j]] = 58112 + j;
		d[58112 + j] = D[227][j];
	}
	D[228] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������洹洧洌浃浈洇洄洙洎洫浍洮洵洚浏浒浔洳涑浯涞涠浞涓涔浜浠浼浣渚淇淅淞渎涿淠渑淦淝淙渖涫渌涮渫湮湎湫溲湟溆湓湔渲渥湄滟溱溘滠漭滢溥溧溽溻溷滗溴滏溏滂溟潢潆潇漤漕滹漯漶潋潴漪漉漩澉澍澌潸潲潼潺濑�".split("");
	for (j = 0; j != D[228].length; ++j) if (D[228][j].charCodeAt(0) !== 65533) {
		e[D[228][j]] = 58368 + j;
		d[58368 + j] = D[228][j];
	}
	D[229] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������濉澧澹澶濂濡濮濞濠濯瀚瀣瀛瀹瀵灏灞宀宄宕宓宥宸甯骞搴寤寮褰寰蹇謇辶迓迕迥迮迤迩迦迳迨逅逄逋逦逑逍逖逡逵逶逭逯遄遑遒遐遨遘遢遛暹遴遽邂邈邃邋彐彗彖彘尻咫屐屙孱屣屦羼弪弩弭艴弼鬻屮妁妃妍妩妪妣�".split("");
	for (j = 0; j != D[229].length; ++j) if (D[229][j].charCodeAt(0) !== 65533) {
		e[D[229][j]] = 58624 + j;
		d[58624 + j] = D[229][j];
	}
	D[230] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������妗姊妫妞妤姒妲妯姗妾娅娆姝娈姣姘姹娌娉娲娴娑娣娓婀婧婊婕娼婢婵胬媪媛婷婺媾嫫媲嫒嫔媸嫠嫣嫱嫖嫦嫘嫜嬉嬗嬖嬲嬷孀尕尜孚孥孳孑孓孢驵驷驸驺驿驽骀骁骅骈骊骐骒骓骖骘骛骜骝骟骠骢骣骥骧纟纡纣纥纨纩�".split("");
	for (j = 0; j != D[230].length; ++j) if (D[230][j].charCodeAt(0) !== 65533) {
		e[D[230][j]] = 58880 + j;
		d[58880 + j] = D[230][j];
	}
	D[231] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������纭纰纾绀绁绂绉绋绌绐绔绗绛绠绡绨绫绮绯绱绲缍绶绺绻绾缁缂缃缇缈缋缌缏缑缒缗缙缜缛缟缡缢缣缤缥缦缧缪缫缬缭缯缰缱缲缳缵幺畿巛甾邕玎玑玮玢玟珏珂珑玷玳珀珉珈珥珙顼琊珩珧珞玺珲琏琪瑛琦琥琨琰琮琬�".split("");
	for (j = 0; j != D[231].length; ++j) if (D[231][j].charCodeAt(0) !== 65533) {
		e[D[231][j]] = 59136 + j;
		d[59136 + j] = D[231][j];
	}
	D[232] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������琛琚瑁瑜瑗瑕瑙瑷瑭瑾璜璎璀璁璇璋璞璨璩璐璧瓒璺韪韫韬杌杓杞杈杩枥枇杪杳枘枧杵枨枞枭枋杷杼柰栉柘栊柩枰栌柙枵柚枳柝栀柃枸柢栎柁柽栲栳桠桡桎桢桄桤梃栝桕桦桁桧桀栾桊桉栩梵梏桴桷梓桫棂楮棼椟椠棹�".split("");
	for (j = 0; j != D[232].length; ++j) if (D[232][j].charCodeAt(0) !== 65533) {
		e[D[232][j]] = 59392 + j;
		d[59392 + j] = D[232][j];
	}
	D[233] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������椤棰椋椁楗棣椐楱椹楠楂楝榄楫榀榘楸椴槌榇榈槎榉楦楣楹榛榧榻榫榭槔榱槁槊槟榕槠榍槿樯槭樗樘橥槲橄樾檠橐橛樵檎橹樽樨橘橼檑檐檩檗檫猷獒殁殂殇殄殒殓殍殚殛殡殪轫轭轱轲轳轵轶轸轷轹轺轼轾辁辂辄辇辋�".split("");
	for (j = 0; j != D[233].length; ++j) if (D[233][j].charCodeAt(0) !== 65533) {
		e[D[233][j]] = 59648 + j;
		d[59648 + j] = D[233][j];
	}
	D[234] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������辍辎辏辘辚軎戋戗戛戟戢戡戥戤戬臧瓯瓴瓿甏甑甓攴旮旯旰昊昙杲昃昕昀炅曷昝昴昱昶昵耆晟晔晁晏晖晡晗晷暄暌暧暝暾曛曜曦曩贲贳贶贻贽赀赅赆赈赉赇赍赕赙觇觊觋觌觎觏觐觑牮犟牝牦牯牾牿犄犋犍犏犒挈挲掰�".split("");
	for (j = 0; j != D[234].length; ++j) if (D[234][j].charCodeAt(0) !== 65533) {
		e[D[234][j]] = 59904 + j;
		d[59904 + j] = D[234][j];
	}
	D[235] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������搿擘耄毪毳毽毵毹氅氇氆氍氕氘氙氚氡氩氤氪氲攵敕敫牍牒牖爰虢刖肟肜肓肼朊肽肱肫肭肴肷胧胨胩胪胛胂胄胙胍胗朐胝胫胱胴胭脍脎胲胼朕脒豚脶脞脬脘脲腈腌腓腴腙腚腱腠腩腼腽腭腧塍媵膈膂膑滕膣膪臌朦臊膻�".split("");
	for (j = 0; j != D[235].length; ++j) if (D[235][j].charCodeAt(0) !== 65533) {
		e[D[235][j]] = 60160 + j;
		d[60160 + j] = D[235][j];
	}
	D[236] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������臁膦欤欷欹歃歆歙飑飒飓飕飙飚殳彀毂觳斐齑斓於旆旄旃旌旎旒旖炀炜炖炝炻烀炷炫炱烨烊焐焓焖焯焱煳煜煨煅煲煊煸煺熘熳熵熨熠燠燔燧燹爝爨灬焘煦熹戾戽扃扈扉礻祀祆祉祛祜祓祚祢祗祠祯祧祺禅禊禚禧禳忑忐�".split("");
	for (j = 0; j != D[236].length; ++j) if (D[236][j].charCodeAt(0) !== 65533) {
		e[D[236][j]] = 60416 + j;
		d[60416 + j] = D[236][j];
	}
	D[237] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������怼恝恚恧恁恙恣悫愆愍慝憩憝懋懑戆肀聿沓泶淼矶矸砀砉砗砘砑斫砭砜砝砹砺砻砟砼砥砬砣砩硎硭硖硗砦硐硇硌硪碛碓碚碇碜碡碣碲碹碥磔磙磉磬磲礅磴礓礤礞礴龛黹黻黼盱眄眍盹眇眈眚眢眙眭眦眵眸睐睑睇睃睚睨�".split("");
	for (j = 0; j != D[237].length; ++j) if (D[237][j].charCodeAt(0) !== 65533) {
		e[D[237][j]] = 60672 + j;
		d[60672 + j] = D[237][j];
	}
	D[238] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������睢睥睿瞍睽瞀瞌瞑瞟瞠瞰瞵瞽町畀畎畋畈畛畲畹疃罘罡罟詈罨罴罱罹羁罾盍盥蠲钅钆钇钋钊钌钍钏钐钔钗钕钚钛钜钣钤钫钪钭钬钯钰钲钴钶钷钸钹钺钼钽钿铄铈铉铊铋铌铍铎铐铑铒铕铖铗铙铘铛铞铟铠铢铤铥铧铨铪�".split("");
	for (j = 0; j != D[238].length; ++j) if (D[238][j].charCodeAt(0) !== 65533) {
		e[D[238][j]] = 60928 + j;
		d[60928 + j] = D[238][j];
	}
	D[239] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������铩铫铮铯铳铴铵铷铹铼铽铿锃锂锆锇锉锊锍锎锏锒锓锔锕锖锘锛锝锞锟锢锪锫锩锬锱锲锴锶锷锸锼锾锿镂锵镄镅镆镉镌镎镏镒镓镔镖镗镘镙镛镞镟镝镡镢镤镥镦镧镨镩镪镫镬镯镱镲镳锺矧矬雉秕秭秣秫稆嵇稃稂稞稔�".split("");
	for (j = 0; j != D[239].length; ++j) if (D[239][j].charCodeAt(0) !== 65533) {
		e[D[239][j]] = 61184 + j;
		d[61184 + j] = D[239][j];
	}
	D[240] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������稹稷穑黏馥穰皈皎皓皙皤瓞瓠甬鸠鸢鸨鸩鸪鸫鸬鸲鸱鸶鸸鸷鸹鸺鸾鹁鹂鹄鹆鹇鹈鹉鹋鹌鹎鹑鹕鹗鹚鹛鹜鹞鹣鹦鹧鹨鹩鹪鹫鹬鹱鹭鹳疒疔疖疠疝疬疣疳疴疸痄疱疰痃痂痖痍痣痨痦痤痫痧瘃痱痼痿瘐瘀瘅瘌瘗瘊瘥瘘瘕瘙�".split("");
	for (j = 0; j != D[240].length; ++j) if (D[240][j].charCodeAt(0) !== 65533) {
		e[D[240][j]] = 61440 + j;
		d[61440 + j] = D[240][j];
	}
	D[241] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������瘛瘼瘢瘠癀瘭瘰瘿瘵癃瘾瘳癍癞癔癜癖癫癯翊竦穸穹窀窆窈窕窦窠窬窨窭窳衤衩衲衽衿袂袢裆袷袼裉裢裎裣裥裱褚裼裨裾裰褡褙褓褛褊褴褫褶襁襦襻疋胥皲皴矜耒耔耖耜耠耢耥耦耧耩耨耱耋耵聃聆聍聒聩聱覃顸颀颃�".split("");
	for (j = 0; j != D[241].length; ++j) if (D[241][j].charCodeAt(0) !== 65533) {
		e[D[241][j]] = 61696 + j;
		d[61696 + j] = D[241][j];
	}
	D[242] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������颉颌颍颏颔颚颛颞颟颡颢颥颦虍虔虬虮虿虺虼虻蚨蚍蚋蚬蚝蚧蚣蚪蚓蚩蚶蛄蚵蛎蚰蚺蚱蚯蛉蛏蚴蛩蛱蛲蛭蛳蛐蜓蛞蛴蛟蛘蛑蜃蜇蛸蜈蜊蜍蜉蜣蜻蜞蜥蜮蜚蜾蝈蜴蜱蜩蜷蜿螂蜢蝽蝾蝻蝠蝰蝌蝮螋蝓蝣蝼蝤蝙蝥螓螯螨蟒�".split("");
	for (j = 0; j != D[242].length; ++j) if (D[242][j].charCodeAt(0) !== 65533) {
		e[D[242][j]] = 61952 + j;
		d[61952 + j] = D[242][j];
	}
	D[243] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������蟆螈螅螭螗螃螫蟥螬螵螳蟋蟓螽蟑蟀蟊蟛蟪蟠蟮蠖蠓蟾蠊蠛蠡蠹蠼缶罂罄罅舐竺竽笈笃笄笕笊笫笏筇笸笪笙笮笱笠笥笤笳笾笞筘筚筅筵筌筝筠筮筻筢筲筱箐箦箧箸箬箝箨箅箪箜箢箫箴篑篁篌篝篚篥篦篪簌篾篼簏簖簋�".split("");
	for (j = 0; j != D[243].length; ++j) if (D[243][j].charCodeAt(0) !== 65533) {
		e[D[243][j]] = 62208 + j;
		d[62208 + j] = D[243][j];
	}
	D[244] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������簟簪簦簸籁籀臾舁舂舄臬衄舡舢舣舭舯舨舫舸舻舳舴舾艄艉艋艏艚艟艨衾袅袈裘裟襞羝羟羧羯羰羲籼敉粑粝粜粞粢粲粼粽糁糇糌糍糈糅糗糨艮暨羿翎翕翥翡翦翩翮翳糸絷綦綮繇纛麸麴赳趄趔趑趱赧赭豇豉酊酐酎酏酤�".split("");
	for (j = 0; j != D[244].length; ++j) if (D[244][j].charCodeAt(0) !== 65533) {
		e[D[244][j]] = 62464 + j;
		d[62464 + j] = D[244][j];
	}
	D[245] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������酢酡酰酩酯酽酾酲酴酹醌醅醐醍醑醢醣醪醭醮醯醵醴醺豕鹾趸跫踅蹙蹩趵趿趼趺跄跖跗跚跞跎跏跛跆跬跷跸跣跹跻跤踉跽踔踝踟踬踮踣踯踺蹀踹踵踽踱蹉蹁蹂蹑蹒蹊蹰蹶蹼蹯蹴躅躏躔躐躜躞豸貂貊貅貘貔斛觖觞觚觜�".split("");
	for (j = 0; j != D[245].length; ++j) if (D[245][j].charCodeAt(0) !== 65533) {
		e[D[245][j]] = 62720 + j;
		d[62720 + j] = D[245][j];
	}
	D[246] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������觥觫觯訾謦靓雩雳雯霆霁霈霏霎霪霭霰霾龀龃龅龆龇龈龉龊龌黾鼋鼍隹隼隽雎雒瞿雠銎銮鋈錾鍪鏊鎏鐾鑫鱿鲂鲅鲆鲇鲈稣鲋鲎鲐鲑鲒鲔鲕鲚鲛鲞鲟鲠鲡鲢鲣鲥鲦鲧鲨鲩鲫鲭鲮鲰鲱鲲鲳鲴鲵鲶鲷鲺鲻鲼鲽鳄鳅鳆鳇鳊鳋�".split("");
	for (j = 0; j != D[246].length; ++j) if (D[246][j].charCodeAt(0) !== 65533) {
		e[D[246][j]] = 62976 + j;
		d[62976 + j] = D[246][j];
	}
	D[247] = "�����������������������������������������������������������������������������������������������������������������������������������������������������������������鳌鳍鳎鳏鳐鳓鳔鳕鳗鳘鳙鳜鳝鳟鳢靼鞅鞑鞒鞔鞯鞫鞣鞲鞴骱骰骷鹘骶骺骼髁髀髅髂髋髌髑魅魃魇魉魈魍魑飨餍餮饕饔髟髡髦髯髫髻髭髹鬈鬏鬓鬟鬣麽麾縻麂麇麈麋麒鏖麝麟黛黜黝黠黟黢黩黧黥黪黯鼢鼬鼯鼹鼷鼽鼾齄�".split("");
	for (j = 0; j != D[247].length; ++j) if (D[247][j].charCodeAt(0) !== 65533) {
		e[D[247][j]] = 63232 + j;
		d[63232 + j] = D[247][j];
	}
	return {
		"enc": e,
		"dec": d
	};
})();
cptable[10029] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÄĀāÉĄÖÜáąČäčĆćéŹźĎíďĒēĖóėôöõúĚěü†°Ę£§•¶ß®©™ę¨≠ģĮįĪ≤≥īĶ∂∑łĻļĽľĹĺŅņŃ¬√ńŇ∆«»…\xA0ňŐÕőŌ–—“”‘’÷◊ōŔŕŘ‹›řŖŗŠ‚„šŚśÁŤťÍŽžŪÓÔūŮÚůŰűŲųÝýķŻŁżĢˇ", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[10079] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûüÝ°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\xA0ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄¤ÐðÞþý·‚„‰ÂÊÁËÈÍÎÏÌÓÔ�ÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[10081] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\xA0ÀÃÕŒœ–—“”‘’÷◊ÿŸĞğİıŞş‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ�ÒÚÛÙ�ˆ˜¯˘˙˚¸˝˛ˇ", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
cptable[28591] = (function() {
	var d = "\0\x07\b	\n\v\f\r\x1B !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\xA0¡¢£¤¥¦§¨©ª«¬­®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ", D = [], e = {};
	for (var i = 0; i != d.length; ++i) {
		if (d.charCodeAt(i) !== 65533) e[d.charAt(i)] = i;
		D[i] = d.charAt(i);
	}
	return {
		"enc": e,
		"dec": D
	};
})();
/*! cputils.js (C) 2013-present SheetJS -- http://sheetjs.com */
var cpt = cptable;
var magic = {
	"1200": "utf16le",
	"1201": "utf16be",
	"12000": "utf32le",
	"12001": "utf32be",
	"16969": "utf64le",
	"20127": "ascii",
	"65000": "utf7",
	"65001": "utf8"
};
var sbcs_cache = [
	874,
	1250,
	1251,
	1252,
	1253,
	1254,
	1255,
	1256,
	1e4
];
var dbcs_cache = [
	932,
	936,
	949,
	950
];
var magic_cache = [65001];
var magic_decode = {};
var magic_encode = {};
var cpdcache = {};
var cpecache = {};
var sfcc = function sfcc(x) {
	return String.fromCharCode(x);
};
var cca = function cca(x) {
	return x.charCodeAt(0);
};
var has_buf = typeof Buffer !== "undefined";
var Buffer_from = function() {};
if (has_buf) {
	var nbfs = !Buffer.from;
	if (!nbfs) try {
		Buffer.from("foo", "utf8");
	} catch (e) {
		nbfs = true;
	}
	Buffer_from = nbfs ? function(buf, enc) {
		return enc ? new Buffer(buf, enc) : new Buffer(buf);
	} : Buffer.from.bind(Buffer);
	if (!Buffer.allocUnsafe) Buffer.allocUnsafe = function(n) {
		return new Buffer(n);
	};
	var mdl = 1024, mdb = Buffer.allocUnsafe(mdl);
	var make_EE = function make_EE(E) {
		var EE = Buffer.allocUnsafe(65536);
		for (var i = 0; i < 65536; ++i) EE[i] = 0;
		var keys = Object.keys(E), len = keys.length;
		for (var ee = 0, e = keys[ee]; ee < len; ++ee) {
			if (!(e = keys[ee])) continue;
			EE[e.charCodeAt(0)] = E[e];
		}
		return EE;
	};
	var sbcs_encode = function make_sbcs_encode(cp) {
		var EE = make_EE(cpt[cp].enc);
		return function sbcs_e(data, ofmt) {
			var len = data.length;
			var out, i = 0, j = 0, D = 0, w = 0;
			if (typeof data === "string") {
				out = Buffer.allocUnsafe(len);
				for (i = 0; i < len; ++i) out[i] = EE[data.charCodeAt(i)];
			} else if (Buffer.isBuffer(data)) {
				out = Buffer.allocUnsafe(2 * len);
				j = 0;
				for (i = 0; i < len; ++i) {
					D = data[i];
					if (D < 128) out[j++] = EE[D];
					else if (D < 224) {
						out[j++] = EE[((D & 31) << 6) + (data[i + 1] & 63)];
						++i;
					} else if (D < 240) {
						out[j++] = EE[((D & 15) << 12) + ((data[i + 1] & 63) << 6) + (data[i + 2] & 63)];
						i += 2;
					} else {
						w = ((D & 7) << 18) + ((data[i + 1] & 63) << 12) + ((data[i + 2] & 63) << 6) + (data[i + 3] & 63);
						i += 3;
						if (w < 65536) out[j++] = EE[w];
						else {
							w -= 65536;
							out[j++] = EE[55296 + (w >> 10 & 1023)];
							out[j++] = EE[56320 + (w & 1023)];
						}
					}
				}
				out = out.slice(0, j);
			} else {
				out = Buffer.allocUnsafe(len);
				for (i = 0; i < len; ++i) out[i] = EE[data[i].charCodeAt(0)];
			}
			if (!ofmt || ofmt === "buf") return out;
			if (ofmt !== "arr") return out.toString("binary");
			return [].slice.call(out);
		};
	};
	var sbcs_decode = function make_sbcs_decode(cp) {
		var D = cpt[cp].dec;
		var DD = Buffer.allocUnsafe(131072), d = 0, c = "";
		for (d = 0; d < D.length; ++d) {
			if (!(c = D[d])) continue;
			var w = c.charCodeAt(0);
			DD[2 * d] = w & 255;
			DD[2 * d + 1] = w >> 8;
		}
		return function sbcs_d(data) {
			var len = data.length, i = 0, j = 0;
			if (2 * len > mdl) {
				mdl = 2 * len;
				mdb = Buffer.allocUnsafe(mdl);
			}
			if (Buffer.isBuffer(data)) for (i = 0; i < len; i++) {
				j = 2 * data[i];
				mdb[2 * i] = DD[j];
				mdb[2 * i + 1] = DD[j + 1];
			}
			else if (typeof data === "string") for (i = 0; i < len; i++) {
				j = 2 * data.charCodeAt(i);
				mdb[2 * i] = DD[j];
				mdb[2 * i + 1] = DD[j + 1];
			}
			else for (i = 0; i < len; i++) {
				j = 2 * data[i];
				mdb[2 * i] = DD[j];
				mdb[2 * i + 1] = DD[j + 1];
			}
			return mdb.slice(0, 2 * len).toString("ucs2");
		};
	};
	var dbcs_encode = function make_dbcs_encode(cp) {
		var E = cpt[cp].enc;
		var EE = Buffer.allocUnsafe(131072);
		for (var i = 0; i < 131072; ++i) EE[i] = 0;
		var keys = Object.keys(E);
		for (var ee = 0, e = keys[ee]; ee < keys.length; ++ee) {
			if (!(e = keys[ee])) continue;
			var f = e.charCodeAt(0);
			EE[2 * f] = E[e] & 255;
			EE[2 * f + 1] = E[e] >> 8;
		}
		return function dbcs_e(data, ofmt) {
			var len = data.length, out = Buffer.allocUnsafe(2 * len), i = 0, j = 0, jj = 0, k = 0, D = 0;
			if (typeof data === "string") {
				for (i = k = 0; i < len; ++i) {
					j = data.charCodeAt(i) * 2;
					out[k++] = EE[j + 1] || EE[j];
					if (EE[j + 1] > 0) out[k++] = EE[j];
				}
				out = out.slice(0, k);
			} else if (Buffer.isBuffer(data)) {
				for (i = k = 0; i < len; ++i) {
					D = data[i];
					if (D < 128) j = D;
					else if (D < 224) {
						j = ((D & 31) << 6) + (data[i + 1] & 63);
						++i;
					} else if (D < 240) {
						j = ((D & 15) << 12) + ((data[i + 1] & 63) << 6) + (data[i + 2] & 63);
						i += 2;
					} else {
						j = ((D & 7) << 18) + ((data[i + 1] & 63) << 12) + ((data[i + 2] & 63) << 6) + (data[i + 3] & 63);
						i += 3;
					}
					if (j < 65536) {
						j *= 2;
						out[k++] = EE[j + 1] || EE[j];
						if (EE[j + 1] > 0) out[k++] = EE[j];
					} else {
						jj = j - 65536;
						j = 2 * (55296 + (jj >> 10 & 1023));
						out[k++] = EE[j + 1] || EE[j];
						if (EE[j + 1] > 0) out[k++] = EE[j];
						j = 2 * (56320 + (jj & 1023));
						out[k++] = EE[j + 1] || EE[j];
						if (EE[j + 1] > 0) out[k++] = EE[j];
					}
				}
				out = out.slice(0, k);
			} else for (i = k = 0; i < len; i++) {
				j = data[i].charCodeAt(0) * 2;
				out[k++] = EE[j + 1] || EE[j];
				if (EE[j + 1] > 0) out[k++] = EE[j];
			}
			if (!ofmt || ofmt === "buf") return out;
			if (ofmt !== "arr") return out.toString("binary");
			return [].slice.call(out);
		};
	};
	var dbcs_decode = function make_dbcs_decode(cp) {
		var D = cpt[cp].dec;
		var DD = Buffer.allocUnsafe(131072), d = 0, c, w = 0, j = 0, i = 0;
		for (i = 0; i < 65536; ++i) {
			DD[2 * i] = 255;
			DD[2 * i + 1] = 253;
		}
		for (d = 0; d < D.length; ++d) {
			if (!(c = D[d])) continue;
			w = c.charCodeAt(0);
			j = 2 * d;
			DD[j] = w & 255;
			DD[j + 1] = w >> 8;
		}
		return function dbcs_d(data) {
			var len = data.length, out = Buffer.allocUnsafe(2 * len), i = 0, j = 0, k = 0;
			if (Buffer.isBuffer(data)) for (i = 0; i < len; i++) {
				j = 2 * data[i];
				if (DD[j] === 255 && DD[j + 1] === 253) {
					j = 2 * ((data[i] << 8) + data[i + 1]);
					++i;
				}
				out[k++] = DD[j];
				out[k++] = DD[j + 1];
			}
			else if (typeof data === "string") for (i = 0; i < len; i++) {
				j = 2 * data.charCodeAt(i);
				if (DD[j] === 255 && DD[j + 1] === 253) {
					j = 2 * ((data.charCodeAt(i) << 8) + data.charCodeAt(i + 1));
					++i;
				}
				out[k++] = DD[j];
				out[k++] = DD[j + 1];
			}
			else for (i = 0; i < len; i++) {
				j = 2 * data[i];
				if (DD[j] === 255 && DD[j + 1] === 253) {
					j = 2 * ((data[i] << 8) + data[i + 1]);
					++i;
				}
				out[k++] = DD[j];
				out[k++] = DD[j + 1];
			}
			return out.slice(0, k).toString("ucs2");
		};
	};
	magic_decode[65001] = function utf8_d(data) {
		if (typeof data === "string") return utf8_d(data.split("").map(cca));
		var len = data.length, w = 0, ww = 0;
		if (4 * len > mdl) {
			mdl = 4 * len;
			mdb = Buffer.allocUnsafe(mdl);
		}
		var i = 0;
		if (len >= 3 && data[0] == 239) {
			if (data[1] == 187 && data[2] == 191) i = 3;
		}
		for (var j = 1, k = 0, D = 0; i < len; i += j) {
			j = 1;
			D = data[i];
			if (D < 128) w = D;
			else if (D < 224) {
				w = (D & 31) * 64 + (data[i + 1] & 63);
				j = 2;
			} else if (D < 240) {
				w = ((D & 15) << 12) + (data[i + 1] & 63) * 64 + (data[i + 2] & 63);
				j = 3;
			} else {
				w = (D & 7) * 262144 + ((data[i + 1] & 63) << 12) + (data[i + 2] & 63) * 64 + (data[i + 3] & 63);
				j = 4;
			}
			if (w < 65536) {
				mdb[k++] = w & 255;
				mdb[k++] = w >> 8;
			} else {
				w -= 65536;
				ww = 55296 + (w >> 10 & 1023);
				w = 56320 + (w & 1023);
				mdb[k++] = ww & 255;
				mdb[k++] = ww >>> 8;
				mdb[k++] = w & 255;
				mdb[k++] = w >>> 8 & 255;
			}
		}
		return mdb.slice(0, k).toString("ucs2");
	};
	magic_encode[65001] = function utf8_e(data, ofmt) {
		if (has_buf && Buffer.isBuffer(data)) {
			if (!ofmt || ofmt === "buf") return data;
			if (ofmt !== "arr") return data.toString("binary");
			return [].slice.call(data);
		}
		var len = data.length, w = 0, ww = 0, j = 0;
		var direct = typeof data === "string";
		if (4 * len > mdl) {
			mdl = 4 * len;
			mdb = Buffer.allocUnsafe(mdl);
		}
		for (var i = 0; i < len; ++i) {
			w = direct ? data.charCodeAt(i) : data[i].charCodeAt(0);
			if (w <= 127) mdb[j++] = w;
			else if (w <= 2047) {
				mdb[j++] = 192 + (w >> 6);
				mdb[j++] = 128 + (w & 63);
			} else if (w >= 55296 && w <= 57343) {
				w -= 55296;
				++i;
				ww = (direct ? data.charCodeAt(i) : data[i].charCodeAt(0)) - 56320 + (w << 10);
				mdb[j++] = 240 + (ww >>> 18 & 7);
				mdb[j++] = 144 + (ww >>> 12 & 63);
				mdb[j++] = 128 + (ww >>> 6 & 63);
				mdb[j++] = 128 + (ww & 63);
			} else {
				mdb[j++] = 224 + (w >> 12);
				mdb[j++] = 128 + (w >> 6 & 63);
				mdb[j++] = 128 + (w & 63);
			}
		}
		if (!ofmt || ofmt === "buf") return mdb.slice(0, j);
		if (ofmt !== "arr") return mdb.slice(0, j).toString("binary");
		return [].slice.call(mdb, 0, j);
	};
}
var encache = function encache() {
	if (has_buf) {
		if (cpdcache[sbcs_cache[0]]) return;
		var i = 0, s = 0;
		for (i = 0; i < sbcs_cache.length; ++i) {
			s = sbcs_cache[i];
			if (cpt[s]) {
				cpdcache[s] = sbcs_decode(s);
				cpecache[s] = sbcs_encode(s);
			}
		}
		for (i = 0; i < dbcs_cache.length; ++i) {
			s = dbcs_cache[i];
			if (cpt[s]) {
				cpdcache[s] = dbcs_decode(s);
				cpecache[s] = dbcs_encode(s);
			}
		}
		for (i = 0; i < magic_cache.length; ++i) {
			s = magic_cache[i];
			if (magic_decode[s]) cpdcache[s] = magic_decode[s];
			if (magic_encode[s]) cpecache[s] = magic_encode[s];
		}
	}
};
var null_enc = function(data, ofmt) {
	return "";
};
var cp_decache = function cp_decache(cp) {
	delete cpdcache[cp];
	delete cpecache[cp];
};
var cache = {
	encache,
	decache: function decache() {
		if (has_buf) {
			if (!cpdcache[sbcs_cache[0]]) return;
			sbcs_cache.forEach(cp_decache);
			dbcs_cache.forEach(cp_decache);
			magic_cache.forEach(cp_decache);
		}
		last_enc = null_enc;
		last_cp = 0;
	},
	sbcs: sbcs_cache,
	dbcs: dbcs_cache
};
encache();
var BM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
var SetD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'(),-./:?";
var last_enc = null_enc;
var last_cp = 0;
var utils = {
	decode: function decode(cp, data) {
		var F;
		if (F = cpdcache[cp]) return F(data);
		if (typeof data === "string") return decode(cp, data.split("").map(cca));
		var len = data.length, out = new Array(len), s = "", w = 0, i = 0, j = 1, k = 0, ww = 0;
		var C = cpt[cp], D, M = "";
		if (C && (D = C.dec)) for (i = 0; i < len; i += j) {
			j = 2;
			s = D[(data[i] << 8) + data[i + 1]];
			if (!s) {
				j = 1;
				s = D[data[i]];
			}
			if (!s) throw new Error("Unrecognized code: " + data[i] + " " + data[i + j - 1] + " " + i + " " + j + " " + D[data[i]]);
			out[k++] = s;
		}
		else if (M = magic[cp]) switch (M) {
			case "utf8":
				if (len >= 3 && data[0] == 239) {
					if (data[1] == 187 && data[2] == 191) i = 3;
				}
				for (; i < len; i += j) {
					j = 1;
					if (data[i] < 128) w = data[i];
					else if (data[i] < 224) {
						w = (data[i] & 31) * 64 + (data[i + 1] & 63);
						j = 2;
					} else if (data[i] < 240) {
						w = ((data[i] & 15) << 12) + (data[i + 1] & 63) * 64 + (data[i + 2] & 63);
						j = 3;
					} else {
						w = (data[i] & 7) * 262144 + ((data[i + 1] & 63) << 12) + (data[i + 2] & 63) * 64 + (data[i + 3] & 63);
						j = 4;
					}
					if (w < 65536) out[k++] = String.fromCharCode(w);
					else {
						w -= 65536;
						ww = 55296 + (w >> 10 & 1023);
						w = 56320 + (w & 1023);
						out[k++] = String.fromCharCode(ww);
						out[k++] = String.fromCharCode(w);
					}
				}
				break;
			case "ascii":
				if (has_buf && Buffer.isBuffer(data)) return data.toString(M);
				for (i = 0; i < len; i++) out[i] = String.fromCharCode(data[i]);
				k = len;
				break;
			case "utf16le":
				if (len >= 2 && data[0] == 255) {
					if (data[1] == 254) i = 2;
				}
				if (has_buf && Buffer.isBuffer(data)) return data.toString(M);
				j = 2;
				for (; i + 1 < len; i += j) out[k++] = String.fromCharCode((data[i + 1] << 8) + data[i]);
				break;
			case "utf16be":
				if (len >= 2 && data[0] == 254) {
					if (data[1] == 255) i = 2;
				}
				j = 2;
				for (; i + 1 < len; i += j) out[k++] = String.fromCharCode((data[i] << 8) + data[i + 1]);
				break;
			case "utf32le":
				if (len >= 4 && data[0] == 255) {
					if (data[1] == 254 && data[2] === 0 && data[3] === 0) i = 4;
				}
				j = 4;
				for (; i < len; i += j) {
					w = (data[i + 3] << 24) + (data[i + 2] << 16) + (data[i + 1] << 8) + data[i];
					if (w > 65535) {
						w -= 65536;
						out[k++] = String.fromCharCode(55296 + (w >> 10 & 1023));
						out[k++] = String.fromCharCode(56320 + (w & 1023));
					} else out[k++] = String.fromCharCode(w);
				}
				break;
			case "utf32be":
				if (len >= 4 && data[3] == 255) {
					if (data[2] == 254 && data[1] === 0 && data[0] === 0) i = 4;
				}
				j = 4;
				for (; i < len; i += j) {
					w = (data[i] << 24) + (data[i + 1] << 16) + (data[i + 2] << 8) + data[i + 3];
					if (w > 65535) {
						w -= 65536;
						out[k++] = String.fromCharCode(55296 + (w >> 10 & 1023));
						out[k++] = String.fromCharCode(56320 + (w & 1023));
					} else out[k++] = String.fromCharCode(w);
				}
				break;
			case "utf7":
				if (len >= 4 && data[0] == 43 && data[1] == 47 && data[2] == 118) {
					if (len >= 5 && data[3] == 56 && data[4] == 45) i = 5;
					else if (data[3] == 56 || data[3] == 57 || data[3] == 43 || data[3] == 47) i = 4;
				}
				for (; i < len; i += j) {
					if (data[i] !== 43) {
						j = 1;
						out[k++] = String.fromCharCode(data[i]);
						continue;
					}
					j = 1;
					if (data[i + 1] === 45) {
						j = 2;
						out[k++] = "+";
						continue;
					}
					while (String.fromCharCode(data[i + j]).match(/[A-Za-z0-9+\/]/)) j++;
					var dash = 0;
					if (data[i + j] === 45) {
						++j;
						dash = 1;
					}
					var tt = [];
					var o64 = "";
					var c1 = 0, c2 = 0, c3 = 0;
					var e1 = 0, e2 = 0, e3 = 0, e4 = 0;
					for (var l = 1; l < j - dash;) {
						e1 = BM.indexOf(String.fromCharCode(data[i + l++]));
						e2 = BM.indexOf(String.fromCharCode(data[i + l++]));
						c1 = e1 << 2 | e2 >> 4;
						tt.push(c1);
						e3 = BM.indexOf(String.fromCharCode(data[i + l++]));
						if (e3 === -1) break;
						c2 = (e2 & 15) << 4 | e3 >> 2;
						tt.push(c2);
						e4 = BM.indexOf(String.fromCharCode(data[i + l++]));
						if (e4 === -1) break;
						c3 = (e3 & 3) << 6 | e4;
						if (e4 < 64) tt.push(c3);
					}
					o64 = decode(1201, tt);
					for (l = 0; l < o64.length; ++l) out[k++] = o64.charAt(l);
				}
				break;
			default: throw new Error("Unsupported magic: " + cp + " " + magic[cp]);
		}
		else throw new Error("Unrecognized CP: " + cp);
		return out.slice(0, k).join("");
	},
	encode: function encode(cp, data, ofmt) {
		if (cp === last_cp && last_enc) return last_enc(data, ofmt);
		if (cpecache[cp]) {
			last_enc = cpecache[last_cp = cp];
			return last_enc(data, ofmt);
		}
		if (has_buf && Buffer.isBuffer(data)) data = data.toString("utf8");
		var len = data.length;
		var out = has_buf ? Buffer.allocUnsafe(4 * len) : [], w = 0, i = 0, j = 0, ww = 0;
		var C = cpt[cp], E, M = "";
		var isstr = typeof data === "string";
		if (C && (E = C.enc)) for (i = 0; i < len; ++i, ++j) {
			w = E[isstr ? data.charAt(i) : data[i]];
			if (w > 255) {
				out[j] = w >> 8;
				out[++j] = w & 255;
			} else out[j] = w & 255;
		}
		else if (M = magic[cp]) switch (M) {
			case "utf8":
				if (has_buf && isstr) {
					out = Buffer_from(data, M);
					j = out.length;
					break;
				}
				for (i = 0; i < len; ++i, ++j) {
					w = isstr ? data.charCodeAt(i) : data[i].charCodeAt(0);
					if (w <= 127) out[j] = w;
					else if (w <= 2047) {
						out[j] = 192 + (w >> 6);
						out[++j] = 128 + (w & 63);
					} else if (w >= 55296 && w <= 57343) {
						w -= 55296;
						ww = (isstr ? data.charCodeAt(++i) : data[++i].charCodeAt(0)) - 56320 + (w << 10);
						out[j] = 240 + (ww >>> 18 & 7);
						out[++j] = 144 + (ww >>> 12 & 63);
						out[++j] = 128 + (ww >>> 6 & 63);
						out[++j] = 128 + (ww & 63);
					} else {
						out[j] = 224 + (w >> 12);
						out[++j] = 128 + (w >> 6 & 63);
						out[++j] = 128 + (w & 63);
					}
				}
				break;
			case "ascii":
				if (has_buf && typeof data === "string") {
					out = Buffer_from(data, M);
					j = out.length;
					break;
				}
				for (i = 0; i < len; ++i, ++j) {
					w = isstr ? data.charCodeAt(i) : data[i].charCodeAt(0);
					if (w <= 127) out[j] = w;
					else throw new Error("bad ascii " + w);
				}
				break;
			case "utf16le":
				if (has_buf && typeof data === "string") {
					out = Buffer_from(data, M);
					j = out.length;
					break;
				}
				for (i = 0; i < len; ++i) {
					w = isstr ? data.charCodeAt(i) : data[i].charCodeAt(0);
					out[j++] = w & 255;
					out[j++] = w >> 8;
				}
				break;
			case "utf16be":
				for (i = 0; i < len; ++i) {
					w = isstr ? data.charCodeAt(i) : data[i].charCodeAt(0);
					out[j++] = w >> 8;
					out[j++] = w & 255;
				}
				break;
			case "utf32le":
				for (i = 0; i < len; ++i) {
					w = isstr ? data.charCodeAt(i) : data[i].charCodeAt(0);
					if (w >= 55296 && w <= 57343) w = 65536 + (w - 55296 << 10) + (data[++i].charCodeAt(0) - 56320);
					out[j++] = w & 255;
					w >>= 8;
					out[j++] = w & 255;
					w >>= 8;
					out[j++] = w & 255;
					w >>= 8;
					out[j++] = w & 255;
				}
				break;
			case "utf32be":
				for (i = 0; i < len; ++i) {
					w = isstr ? data.charCodeAt(i) : data[i].charCodeAt(0);
					if (w >= 55296 && w <= 57343) w = 65536 + (w - 55296 << 10) + (data[++i].charCodeAt(0) - 56320);
					out[j + 3] = w & 255;
					w >>= 8;
					out[j + 2] = w & 255;
					w >>= 8;
					out[j + 1] = w & 255;
					w >>= 8;
					out[j] = w & 255;
					j += 4;
				}
				break;
			case "utf7":
				for (i = 0; i < len; i++) {
					var c = isstr ? data.charAt(i) : data[i].charAt(0);
					if (c === "+") {
						out[j++] = 43;
						out[j++] = 45;
						continue;
					}
					if (SetD.indexOf(c) > -1) {
						out[j++] = c.charCodeAt(0);
						continue;
					}
					var tt = encode(1201, c);
					out[j++] = 43;
					out[j++] = BM.charCodeAt(tt[0] >> 2);
					out[j++] = BM.charCodeAt(((tt[0] & 3) << 4) + ((tt[1] || 0) >> 4));
					out[j++] = BM.charCodeAt(((tt[1] & 15) << 2) + ((tt[2] || 0) >> 6));
					out[j++] = 45;
				}
				break;
			default: throw new Error("Unsupported magic: " + cp + " " + magic[cp]);
		}
		else throw new Error("Unrecognized CP: " + cp);
		out = out.slice(0, j);
		if (!has_buf) return ofmt == "str" ? out.map(sfcc).join("") : out;
		if (!ofmt || ofmt === "buf") return out;
		if (ofmt !== "arr") return out.toString("binary");
		return [].slice.call(out);
	},
	hascp: function hascp(cp) {
		return !!(cpt[cp] || magic[cp]);
	},
	magic,
	cache
};
//#endregion
//#region packages/tabular-import/src/limits.ts
var MIB = 1048576;
var DEFAULT_TABULAR_IMPORT_LIMITS = Object.freeze({
	maxFileBytes: 5 * MIB,
	maxWorksheets: 32,
	maxRows: 1e5,
	maxColumns: 256,
	maxCells: 5e6,
	maxStringLength: 32768,
	maxZipEntries: 512,
	maxZipTotalUncompressedBytes: 64 * MIB,
	maxZipEntryUncompressedBytes: 32 * MIB,
	maxZipCompressionRatio: 250,
	maxZipPathDepth: 16
});
var HARD_TABULAR_IMPORT_LIMITS = Object.freeze({
	maxFileBytes: 25 * MIB,
	maxWorksheets: 256,
	maxRows: 5e5,
	maxColumns: 1024,
	maxCells: 2e7,
	maxStringLength: 1e6,
	maxZipEntries: 4096,
	maxZipTotalUncompressedBytes: 256 * MIB,
	maxZipEntryUncompressedBytes: 128 * MIB,
	maxZipCompressionRatio: 2e3,
	maxZipPathDepth: 32
});
Object.freeze(Object.keys(DEFAULT_TABULAR_IMPORT_LIMITS));
//#endregion
//#region packages/tabular-import/src/importer.ts
set_cptable(cpexcel_full_exports);
Object.freeze({
	formulas: "cached-scalar-only-never-evaluated",
	vba: "never-executed-never-returned",
	macrosheets: "listed-not-selectable-never-returned",
	comments: "discarded",
	hyperlinks: "discarded",
	formatting: "discarded",
	dates: "excel-wall-time-iso-string-no-host-timezone"
});
//#endregion
//#region packages/analysis/src/fitted-jena-adapter-v2.ts
init_build_identity();
init_trajectory();
init_validation();
/** Return the package-build identity injected into the exact consumed artifact. */
function getAnalysisBuildIdentityV2() {
	return structuredClone(ANALYSIS_BUILD_IDENTITY);
}
Object.freeze({
	nullValue: "",
	nonFiniteNumbers: "reject",
	spreadsheetFormulas: "neutralize",
	includeFinalRecordTerminator: true
});
Object.freeze([
	"nullValue",
	"nonFiniteNumbers",
	"spreadsheetFormulas",
	"includeFinalRecordTerminator"
]);
new TextEncoder();
//#endregion
//#region packages/export/src/zip.ts
var DEFAULT_DETERMINISTIC_ZIP_LIMITS = Object.freeze({
	maxFiles: 64,
	maxFileBytes: 8388608,
	maxTotalBytes: 33554432,
	maxPathBytes: 512
});
Object.freeze({
	maxFiles: 1024,
	maxFileBytes: 67108864,
	maxTotalBytes: 134217728,
	maxPathBytes: 4096
});
Object.freeze(Object.keys(DEFAULT_DETERMINISTIC_ZIP_LIMITS));
new TextEncoder();
(() => {
	const table = /* @__PURE__ */ new Uint32Array(256);
	for (let index = 0; index < table.length; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
		table[index] = value >>> 0;
	}
	return table;
})();
//#endregion
//#region packages/stats/src/types.ts
var STATS_V1_CONTRACT = Object.freeze({
	schemaVersion: "3dena.stats.contract.v1",
	direction: "A-minus-B",
	missing: "drop-explicit-null",
	ties: "exact-value-midrank",
	signedRankZeros: "drop-exact-zero",
	rankInference: "asymptotic-normal",
	continuityCorrection: true,
	independentCohenD: "pooled-sample-standard-deviation",
	pairedCohenD: "mean-paired-difference-over-sample-sd",
	meanDifferenceConfidenceInterval: "alternative-aligned-t-interval-95-percent",
	pValueAdjustmentFamily: "caller-supplied-complete-family"
});
var StatsInputError = class extends Error {
	code;
	path;
	constructor(code, path, message) {
		super(`${path}: ${message}`);
		this.name = "StatsInputError";
		this.code = code;
		this.path = path;
	}
};
function reject$5(code, path, message) {
	throw new StatsInputError(code, path, message);
}
function deepFreeze$4(value) {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze$4(nested);
		Object.freeze(value);
	}
	return value;
}
//#endregion
//#region packages/stats/src/adjust.ts
function validate(pValues) {
	pValues.forEach((value, index) => {
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) reject$5("INVALID_P_VALUE", `pValues[${index}]`, "must be finite and in [0, 1]");
	});
}
function adjustPValues(pValues, method) {
	validate(pValues);
	if (![
		"none",
		"holm",
		"bh",
		"bonferroni"
	].includes(method)) reject$5("INVALID_ADJUSTMENT", "method", "must be none, holm, bh, or bonferroni");
	const count = pValues.length;
	if (method === "none") return deepFreeze$4([...pValues]);
	if (method === "bonferroni") return deepFreeze$4(pValues.map((value) => Math.min(1, value * count)));
	const ordered = pValues.map((value, index) => ({
		value,
		index
	})).sort((left, right) => left.value - right.value || left.index - right.index);
	const adjusted = Array.from({ length: count }, () => 0);
	if (method === "holm") {
		let running = 0;
		ordered.forEach((entry, rank) => {
			running = Math.max(running, Math.min(1, entry.value * (count - rank)));
			adjusted[entry.index] = running;
		});
		return deepFreeze$4(adjusted);
	}
	let running = 1;
	for (let rank = count - 1; rank >= 0; rank -= 1) {
		const entry = ordered[rank];
		running = Math.min(running, entry.value * count / (rank + 1));
		adjusted[entry.index] = Math.min(1, running);
	}
	return deepFreeze$4(adjusted);
}
//#endregion
//#region packages/stats/src/numerics.ts
function compensatedSum(values) {
	let sum = 0;
	let correction = 0;
	for (const value of values) {
		const next = sum + value;
		if (Math.abs(sum) >= Math.abs(value)) correction += sum - next + value;
		else correction += value - next + sum;
		sum = next;
	}
	return sum + correction;
}
function commonScale(...groups) {
	let scale = 0;
	for (const group of groups) for (const value of group) scale = Math.max(scale, Math.abs(value));
	return scale === 0 ? 1 : scale;
}
function describe(values, scale = commonScale(values)) {
	if (values.length === 0) reject$5("EMPTY_SAMPLE", "values", "must contain at least one value");
	const normalized = values.map((value) => value / scale);
	const meanUnit = compensatedSum(normalized) / normalized.length;
	const centeredSquares = normalized.map((value) => {
		const centered = value - meanUnit;
		return centered * centered;
	});
	const varianceUnit = normalized.length > 1 ? Math.max(0, compensatedSum(centeredSquares) / (normalized.length - 1)) : 0;
	const standardDeviationUnit = Math.sqrt(varianceUnit);
	const mean = meanUnit * scale;
	if (!Number.isFinite(mean)) reject$5("NUMERIC_OVERFLOW", "values", "the sample mean is not representable as a finite number");
	return {
		n: values.length,
		scale,
		meanUnit,
		varianceUnit,
		standardDeviationUnit,
		mean
	};
}
function representableScaled(valueUnit, scale) {
	const value = valueUnit * scale;
	return Number.isFinite(value) ? value : null;
}
var LANCZOS_COEFFICIENTS$1 = [
	.9999999999998099,
	676.5203681218851,
	-1259.1392167224028,
	771.3234287776531,
	-176.6150291621406,
	12.507343278686905,
	-.13857109526572012,
	9984369578019572e-21,
	1.5056327351493116e-7
];
function logGamma$1(value) {
	if (value < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma$1(1 - value);
	const shifted = value - 1;
	let series = LANCZOS_COEFFICIENTS$1[0];
	for (let index = 1; index < LANCZOS_COEFFICIENTS$1.length; index += 1) series += LANCZOS_COEFFICIENTS$1[index] / (shifted + index);
	const base = shifted + 7.5;
	return .5 * Math.log(2 * Math.PI) + (shifted + .5) * Math.log(base) - base + Math.log(series);
}
function betaContinuedFraction(a, b, x) {
	const maximumIterations = 200;
	const epsilon = 3e-14;
	const floor = 1e-300;
	const qab = a + b;
	const qap = a + 1;
	const qam = a - 1;
	let c = 1;
	let d = 1 - qab * x / qap;
	if (Math.abs(d) < floor) d = floor;
	d = 1 / d;
	let result = d;
	for (let iteration = 1; iteration <= maximumIterations; iteration += 1) {
		const twice = 2 * iteration;
		let coefficient = iteration * (b - iteration) * x / ((qam + twice) * (a + twice));
		d = 1 + coefficient * d;
		if (Math.abs(d) < floor) d = floor;
		c = 1 + coefficient / c;
		if (Math.abs(c) < floor) c = floor;
		d = 1 / d;
		result *= d * c;
		coefficient = -((a + iteration) * (qab + iteration) * x) / ((a + twice) * (qap + twice));
		d = 1 + coefficient * d;
		if (Math.abs(d) < floor) d = floor;
		c = 1 + coefficient / c;
		if (Math.abs(c) < floor) c = floor;
		d = 1 / d;
		const delta = d * c;
		result *= delta;
		if (Math.abs(delta - 1) <= epsilon) return result;
	}
	reject$5("NUMERIC_CONVERGENCE", "studentT", "incomplete beta evaluation did not converge");
}
function regularizedBeta(x, a, b) {
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const front = Math.exp(logGamma$1(a + b) - logGamma$1(a) - logGamma$1(b) + a * Math.log(x) + b * Math.log1p(-x));
	if (x < (a + 1) / (a + b + 2)) return front * betaContinuedFraction(a, b, x) / a;
	return 1 - front * betaContinuedFraction(b, a, 1 - x) / b;
}
function studentTCdf(statistic, degreesOfFreedom) {
	if (statistic === 0) return .5;
	if (!(degreesOfFreedom > 0) || !Number.isFinite(degreesOfFreedom)) reject$5("INVALID_DEGREES_OF_FREEDOM", "degreesOfFreedom", "must be finite and positive");
	const tail = .5 * regularizedBeta(degreesOfFreedom / (degreesOfFreedom + statistic * statistic), degreesOfFreedom / 2, .5);
	return statistic > 0 ? 1 - tail : tail;
}
/** Deterministic inverse of `studentTCdf` for versioned confidence intervals. */
function studentTQuantile(probability, degreesOfFreedom) {
	if (!(probability > 0 && probability < 1) || !Number.isFinite(probability)) reject$5("INVALID_PROBABILITY", "probability", "must be finite and strictly between zero and one");
	if (!(degreesOfFreedom > 0) || !Number.isFinite(degreesOfFreedom)) reject$5("INVALID_DEGREES_OF_FREEDOM", "degreesOfFreedom", "must be finite and positive");
	if (probability === .5) return 0;
	if (probability < .5) return -studentTQuantile(1 - probability, degreesOfFreedom);
	let lower = 0;
	let upper = 1;
	while (studentTCdf(upper, degreesOfFreedom) < probability) {
		upper *= 2;
		if (!Number.isFinite(upper) || upper > Number.MAX_VALUE / 2) reject$5("NUMERIC_CONVERGENCE", "studentTQuantile", "failed to bracket the requested quantile");
	}
	for (let iteration = 0; iteration < 100; iteration += 1) {
		const midpoint = lower + (upper - lower) / 2;
		if (studentTCdf(midpoint, degreesOfFreedom) < probability) lower = midpoint;
		else upper = midpoint;
	}
	return lower + (upper - lower) / 2;
}
function erfc(value) {
	const magnitude = Math.abs(value);
	const t = 1 / (1 + .5 * magnitude);
	const approximation = t * Math.exp(-magnitude * magnitude - 1.26551223 + t * (1.00002368 + t * (.37409196 + t * (.09678418 + t * (-.18628806 + t * (.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-.82215223 + t * .17087277)))))))));
	return value >= 0 ? approximation : 2 - approximation;
}
function normalCdf(value) {
	if (value === 0) return .5;
	return .5 * erfc(-value / Math.SQRT2);
}
function pValueFromCdf(cdf, alternative) {
	const bounded = Math.max(0, Math.min(1, cdf));
	if (alternative === "greater") return Math.max(0, 1 - bounded);
	if (alternative === "less") return bounded;
	return Math.max(0, Math.min(1, 2 * Math.min(bounded, 1 - bounded)));
}
function continuityCorrectedZ(differenceFromNull, standardDeviation, alternative) {
	if (differenceFromNull === 0) return 0;
	return (differenceFromNull - (alternative === "two-sided" ? .5 * Math.sign(differenceFromNull) : alternative === "greater" ? .5 : -.5)) / standardDeviation;
}
function rankValues(values) {
	const ordered = values.map((value, index) => ({
		value,
		index
	})).sort((left, right) => left.value - right.value || left.index - right.index);
	const ranks = Array.from({ length: values.length }, () => 0);
	const tieSizes = [];
	let start = 0;
	while (start < ordered.length) {
		let end = start + 1;
		while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
		const rank = (start + 1 + end) / 2;
		for (let index = start; index < end; index += 1) ranks[ordered[index].index] = rank;
		if (end - start > 1) tieSizes.push(end - start);
		start = end;
	}
	return {
		ranks,
		tieSizes
	};
}
//#endregion
//#region packages/stats/src/independent.ts
var MAX_OBSERVATIONS_PER_SIDE$1 = 1e6;
var CONFIDENCE_LEVEL$1 = .95;
function validateAlternative$1(value) {
	if (value !== "two-sided" && value !== "greater" && value !== "less") reject$5("INVALID_ALTERNATIVE", "input.alternative", "must be two-sided, greater, or less");
}
function validateSample$1(sample, path) {
	if (!sample || typeof sample.label !== "string" || sample.label.trim() === "") reject$5("INVALID_SAMPLE_LABEL", `${path}.label`, "must be a non-blank string");
	if (!Array.isArray(sample.values)) reject$5("INVALID_SAMPLE", `${path}.values`, "must be an array");
	if (sample.values.length > MAX_OBSERVATIONS_PER_SIDE$1) reject$5("SAMPLE_LIMIT", `${path}.values`, `must not exceed ${MAX_OBSERVATIONS_PER_SIDE$1} observations`);
	const values = [];
	let droppedMissing = 0;
	Array.from(sample.values).forEach((value, index) => {
		if (value === null) {
			droppedMissing += 1;
			return;
		}
		if (typeof value !== "number" || !Number.isFinite(value)) reject$5("NON_FINITE_VALUE", `${path}.values[${index}]`, "must be a finite number or explicit null");
		values.push(value);
	});
	if (values.length < 2) reject$5("INSUFFICIENT_SAMPLE", `${path}.values`, "requires at least two valid observations for Welch and Cohen's d");
	return {
		label: sample.label,
		input: sample.values.length,
		values,
		droppedMissing
	};
}
function welchTest(left, right, alternative, diagnostics) {
	const scale = commonScale(left, right);
	const a = describe(left);
	const b = describe(right);
	const differenceUnit = a.meanUnit * (a.scale / scale) - b.meanUnit * (b.scale / scale);
	const meanDifference = representableScaled(differenceUnit, scale);
	if (meanDifference === null) diagnostics.push({
		code: "UNREPRESENTABLE_MEAN_DIFFERENCE",
		severity: "warning",
		message: "The finite-input A-minus-B mean difference exceeds the representable JavaScript range; scale-free inference remains available."
	});
	const uncertaintyScale = Math.max(a.standardDeviationUnit > 0 ? a.scale : 0, b.standardDeviationUnit > 0 ? b.scale : 0) || 1;
	const standardDeviationA = a.standardDeviationUnit * (a.scale / uncertaintyScale);
	const standardDeviationB = b.standardDeviationUnit * (b.scale / uncertaintyScale);
	const standardErrorA = standardDeviationA / Math.sqrt(a.n);
	const standardErrorB = standardDeviationB / Math.sqrt(b.n);
	const standardError = Math.hypot(standardErrorA, standardErrorB);
	const uncertaintyToResultScale = uncertaintyScale / scale;
	const standardErrorUnit = standardError * uncertaintyToResultScale;
	const ratioToUncertainty = (denominator) => {
		if (differenceUnit === 0) return 0;
		const denominatorUnit = denominator * uncertaintyToResultScale;
		if (denominatorUnit > 0) {
			const direct = differenceUnit / denominatorUnit;
			if (Number.isFinite(direct)) return direct;
		}
		const logMagnitude = Math.log(Math.abs(differenceUnit)) + Math.log(scale) - Math.log(denominator) - Math.log(uncertaintyScale);
		if (logMagnitude > Math.log(Number.MAX_VALUE)) return null;
		const value = Math.sign(differenceUnit) * Math.exp(logMagnitude);
		return Number.isFinite(value) ? value : null;
	};
	const limitingPValue = () => {
		if (differenceUnit === 0) return 1;
		if (alternative === "two-sided") return 0;
		if (alternative === "greater") return differenceUnit > 0 ? 0 : 1;
		return differenceUnit < 0 ? 0 : 1;
	};
	let statistic;
	let degreesOfFreedom;
	let pValue;
	if (standardError === 0) {
		diagnostics.push({
			code: "ZERO_WELCH_STANDARD_ERROR",
			severity: "warning",
			message: "Both groups have zero within-group variance; a finite Welch statistic and degrees of freedom are undefined."
		});
		statistic = differenceUnit === 0 ? 0 : null;
		degreesOfFreedom = null;
		pValue = limitingPValue();
	} else {
		const maximumStandardError = Math.max(standardErrorA, standardErrorB);
		const normalizedVarianceA = (standardErrorA / maximumStandardError) ** 2;
		const normalizedVarianceB = (standardErrorB / maximumStandardError) ** 2;
		degreesOfFreedom = (normalizedVarianceA + normalizedVarianceB) ** 2 / (normalizedVarianceA ** 2 / (a.n - 1) + normalizedVarianceB ** 2 / (b.n - 1));
		statistic = ratioToUncertainty(standardError);
		if (statistic === null) {
			diagnostics.push({
				code: "UNREPRESENTABLE_WELCH_STATISTIC",
				severity: "warning",
				message: "The finite-input Welch statistic exceeds the representable JavaScript range; p is reported at its directional limiting value."
			});
			pValue = limitingPValue();
		} else pValue = pValueFromCdf(studentTCdf(statistic, degreesOfFreedom), alternative);
	}
	const pooledVariance = ((a.n - 1) * standardDeviationA ** 2 + (b.n - 1) * standardDeviationB ** 2) / (a.n + b.n - 2);
	const pooledStandardDeviation = Math.sqrt(Math.max(0, pooledVariance));
	const cohensD = pooledStandardDeviation === 0 ? null : ratioToUncertainty(pooledStandardDeviation);
	if (pooledStandardDeviation === 0) diagnostics.push({
		code: "ZERO_POOLED_VARIANCE",
		severity: "warning",
		message: "Cohen's d is undefined because the pooled sample variance is zero."
	});
	else if (cohensD === null) diagnostics.push({
		code: "UNREPRESENTABLE_COHENS_D",
		severity: "warning",
		message: "The finite-input Cohen's d exceeds the representable JavaScript range and is reported as null."
	});
	const critical = degreesOfFreedom === null ? null : studentTQuantile(alternative === "two-sided" ? 1 - .050000000000000044 / 2 : CONFIDENCE_LEVEL$1, degreesOfFreedom);
	const lowerUnit = alternative === "less" || critical === null ? null : differenceUnit - critical * standardErrorUnit;
	const upperUnit = alternative === "greater" || critical === null ? null : differenceUnit + critical * standardErrorUnit;
	const finiteBound = (valueUnit, side) => {
		const value = representableScaled(valueUnit, scale);
		if (value !== null) return {
			kind: "finite",
			value
		};
		diagnostics.push({
			code: "UNREPRESENTABLE_CONFIDENCE_BOUND",
			severity: "warning",
			message: `The ${side} Welch confidence bound exceeds the representable JavaScript range.`
		});
		return { kind: "unrepresentable" };
	};
	const confidenceInterval = {
		method: "welch-t-mean-difference-v1",
		confidenceLevel: CONFIDENCE_LEVEL$1,
		alternative,
		lower: critical === null ? { kind: "undefined" } : lowerUnit === null ? { kind: "negative-infinity" } : finiteBound(lowerUnit, "lower"),
		upper: critical === null ? { kind: "undefined" } : upperUnit === null ? { kind: "positive-infinity" } : finiteBound(upperUnit, "upper")
	};
	return {
		result: {
			method: "welch-t-v1",
			alternative,
			statistic,
			degreesOfFreedom,
			pValue
		},
		meanA: a.mean,
		meanB: b.mean,
		meanDifference,
		confidenceInterval,
		cohensD
	};
}
function mannWhitney(left, right, alternative, diagnostics) {
	const combined = [...left, ...right];
	const { ranks, tieSizes } = rankValues(combined);
	const rankSumA = ranks.slice(0, left.length).reduce((sum, rank) => sum + rank, 0);
	const product = left.length * right.length;
	const uA = rankSumA - left.length * (left.length + 1) / 2;
	const uB = product - uA;
	const mean = product / 2;
	const total = combined.length;
	const tieCorrection = tieSizes.reduce((sum, size) => sum + size ** 3 - size, 0);
	const variance = product / 12 * (total + 1 - tieCorrection / (total * (total - 1)));
	let z = 0;
	let pValue = 1;
	if (variance > 0) {
		z = continuityCorrectedZ(uA - mean, Math.sqrt(variance), alternative);
		pValue = pValueFromCdf(normalCdf(z), alternative);
	} else diagnostics.push({
		code: "DEGENERATE_RANK_SUM",
		severity: "warning",
		message: "Every pooled observation is tied; the asymptotic rank-sum variance is zero and p is reported as 1."
	});
	const tiedObservations = tieSizes.reduce((sum, size) => sum + size, 0);
	if (tieSizes.length > 0) diagnostics.push({
		code: "RANK_SUM_TIES",
		severity: "info",
		message: "Exact-value ties received midranks and the asymptotic variance was tie-corrected."
	});
	return {
		result: {
			method: "mann-whitney-asymptotic-v1",
			alternative,
			tiePolicy: "exact-value-midrank",
			continuityCorrection: true,
			uA,
			uB,
			z,
			pValue,
			tieGroups: tieSizes.length,
			tiedObservations
		},
		rankBiserial: product === 0 ? 0 : 2 * uA / product - 1
	};
}
function analyzeIndependentSamples(input) {
	if (!input || input.schemaVersion !== "3dena.stats.independent-input.v1") reject$5("INVALID_SCHEMA_VERSION", "input.schemaVersion", "must be 3dena.stats.independent-input.v1");
	validateAlternative$1(input.alternative);
	const left = validateSample$1(input.sideA, "input.sideA");
	const right = validateSample$1(input.sideB, "input.sideB");
	const diagnostics = [];
	if (left.droppedMissing + right.droppedMissing > 0) diagnostics.push({
		code: "MISSING_VALUES_DROPPED",
		severity: "info",
		message: "Explicit null observations were dropped independently before analysis."
	});
	const welch = welchTest(left.values, right.values, input.alternative, diagnostics);
	const rank = mannWhitney(left.values, right.values, input.alternative, diagnostics);
	const raw = [welch.result.pValue, rank.result.pValue];
	const adjusted = adjustPValues(raw, input.adjustment);
	return deepFreeze$4({
		schemaVersion: "3dena.stats.independent-result.v1",
		design: "independent",
		direction: "A-minus-B",
		contract: STATS_V1_CONTRACT,
		alternative: input.alternative,
		samples: {
			sideA: {
				label: left.label,
				input: left.input,
				valid: left.values.length,
				droppedMissing: left.droppedMissing
			},
			sideB: {
				label: right.label,
				input: right.input,
				valid: right.values.length,
				droppedMissing: right.droppedMissing
			}
		},
		estimates: {
			meanA: welch.meanA,
			meanB: welch.meanB,
			meanDifference: welch.meanDifference,
			confidenceInterval: welch.confidenceInterval
		},
		welch: welch.result,
		mannWhitney: rank.result,
		effects: {
			cohensD: welch.cohensD,
			rankBiserial: rank.rankBiserial
		},
		adjustment: {
			method: input.adjustment,
			raw,
			adjusted
		},
		diagnostics
	});
}
//#endregion
//#region packages/stats/src/paired.ts
var MAX_OBSERVATIONS_PER_SIDE = 1e6;
var CONFIDENCE_LEVEL = .95;
function validateAlternative(value) {
	if (value !== "two-sided" && value !== "greater" && value !== "less") reject$5("INVALID_ALTERNATIVE", "input.alternative", "must be two-sided, greater, or less");
}
function identityKey(identity, path) {
	if (!identity || !Array.isArray(identity.components) || identity.components.length === 0) reject$5("INVALID_IDENTITY", path, "must contain at least one typed component");
	const names = /* @__PURE__ */ new Set();
	const normalized = identity.components.map((component, index) => {
		const componentPath = `${path}.components[${index}]`;
		if (!component || typeof component.name !== "string" || component.name.trim() === "") reject$5("INVALID_IDENTITY_COMPONENT", `${componentPath}.name`, "must be a non-blank string");
		if (names.has(component.name)) reject$5("DUPLICATE_IDENTITY_COMPONENT", componentPath, "component names must be unique within an identity");
		names.add(component.name);
		if (component.type === "string" && typeof component.value === "string") return [
			component.name,
			"string",
			component.value
		];
		if (component.type === "boolean" && typeof component.value === "boolean") return [
			component.name,
			"boolean",
			component.value
		];
		if (component.type === "number" && typeof component.value === "number") {
			if (!Number.isFinite(component.value)) reject$5("NON_FINITE_IDENTITY_NUMBER", `${componentPath}.value`, "must be finite");
			if (Number.isInteger(component.value) && !Number.isSafeInteger(component.value)) reject$5("UNSAFE_IDENTITY_NUMBER", `${componentPath}.value`, "unsafe integer IDs must be supplied as strings");
			return [
				component.name,
				"number",
				Object.is(component.value, -0) ? 0 : component.value
			];
		}
		reject$5("IDENTITY_TYPE_MISMATCH", componentPath, "declared identity type must match its value");
	});
	return {
		components: identity.components.map((component) => ({ ...component })),
		canonical: JSON.stringify(normalized),
		display: identity.components.map((component) => String(component.value)).join(" · ")
	};
}
function validateSample(sample, path) {
	if (!sample || typeof sample.label !== "string" || sample.label.trim() === "") reject$5("INVALID_SAMPLE_LABEL", `${path}.label`, "must be a non-blank string");
	if (!Array.isArray(sample.observations)) reject$5("INVALID_SAMPLE", `${path}.observations`, "must be an array");
	if (sample.observations.length > MAX_OBSERVATIONS_PER_SIDE) reject$5("SAMPLE_LIMIT", `${path}.observations`, `must not exceed ${MAX_OBSERVATIONS_PER_SIDE} observations`);
	const output = /* @__PURE__ */ new Map();
	Array.from(sample.observations).forEach((observation, index) => {
		const observationPath = `${path}.observations[${index}]`;
		if (!observation || typeof observation !== "object") reject$5("INVALID_OBSERVATION", observationPath, "must be an observation object");
		const key = identityKey(observation.id, `${observationPath}.id`);
		if (output.has(key.canonical)) reject$5("DUPLICATE_PAIRED_ID", `${observationPath}.id`, "each typed identity may occur only once per side");
		if (observation.value !== null && (typeof observation.value !== "number" || !Number.isFinite(observation.value))) reject$5("NON_FINITE_VALUE", `${observationPath}.value`, "must be a finite number or explicit null");
		output.set(key.canonical, {
			key,
			value: observation.value
		});
	});
	return output;
}
function signedRank(differences, alternative, diagnostics) {
	const nonZero = differences.filter((difference) => difference !== 0);
	const zeroCount = differences.length - nonZero.length;
	if (zeroCount > 0) diagnostics.push({
		code: "ZERO_DIFFERENCES_DROPPED",
		severity: "info",
		message: "Exact zero paired differences were excluded before signed-rank ranking."
	});
	if (nonZero.length === 0) {
		diagnostics.push({
			code: "ALL_ZERO_DIFFERENCES",
			severity: "warning",
			message: "Every valid paired difference is zero; W+, W-, and rank-biserial are zero and p is reported as 1."
		});
		return {
			result: {
				method: "wilcoxon-signed-rank-asymptotic-v1",
				alternative,
				tiePolicy: "exact-absolute-difference-midrank",
				zeroPolicy: "drop-exact-zero",
				continuityCorrection: true,
				statistic: 0,
				wPositive: 0,
				wNegative: 0,
				z: 0,
				pValue: 1,
				tieGroups: 0,
				tiedObservations: 0
			},
			rankBiserial: 0,
			zeroCount
		};
	}
	const { ranks, tieSizes } = rankValues(nonZero.map(Math.abs));
	let wPositive = 0;
	let wNegative = 0;
	nonZero.forEach((difference, index) => {
		if (difference > 0) wPositive += ranks[index];
		else wNegative += ranks[index];
	});
	const count = nonZero.length;
	const mean = count * (count + 1) / 4;
	const tieCorrection = tieSizes.reduce((sum, size) => sum + size ** 3 - size, 0);
	const variance = (count * (count + 1) * (2 * count + 1) - tieCorrection / 2) / 24;
	let z = 0;
	let pValue = 1;
	if (variance > 0) {
		z = continuityCorrectedZ(wPositive - mean, Math.sqrt(variance), alternative);
		pValue = pValueFromCdf(normalCdf(z), alternative);
	}
	if (tieSizes.length > 0) diagnostics.push({
		code: "ABSOLUTE_DIFFERENCE_TIES",
		severity: "info",
		message: "Equal absolute paired differences received midranks and the asymptotic variance was tie-corrected."
	});
	return {
		result: {
			method: "wilcoxon-signed-rank-asymptotic-v1",
			alternative,
			tiePolicy: "exact-absolute-difference-midrank",
			zeroPolicy: "drop-exact-zero",
			continuityCorrection: true,
			statistic: wPositive,
			wPositive,
			wNegative,
			z,
			pValue,
			tieGroups: tieSizes.length,
			tiedObservations: tieSizes.reduce((sum, size) => sum + size, 0)
		},
		rankBiserial: (wPositive - wNegative) / (wPositive + wNegative),
		zeroCount
	};
}
function analyzePairedSamples(input) {
	if (!input || input.schemaVersion !== "3dena.stats.paired-input.v1") reject$5("INVALID_SCHEMA_VERSION", "input.schemaVersion", "must be 3dena.stats.paired-input.v1");
	validateAlternative(input.alternative);
	const sideA = validateSample(input.sideA, "input.sideA");
	const sideB = validateSample(input.sideB, "input.sideB");
	const matched = [...sideA.keys()].filter((key) => sideB.has(key));
	const unmatchedA = sideA.size - matched.length;
	const unmatchedB = sideB.size - matched.length;
	const validPairs = matched.map((key) => [sideA.get(key), sideB.get(key)]).filter(([left, right]) => left.value !== null && right.value !== null);
	const droppedMissingPairs = matched.length - validPairs.length;
	if (validPairs.length < 2) reject$5("INSUFFICIENT_PAIRS", "input", "requires at least two exact matched pairs with finite values");
	const diagnostics = [];
	if (unmatchedA + unmatchedB > 0) diagnostics.push({
		code: "UNMATCHED_OBSERVATIONS_DROPPED",
		severity: "info",
		message: "Typed identities present on only one side were excluded from the paired estimand."
	});
	if (droppedMissingPairs > 0) diagnostics.push({
		code: "MISSING_PAIRS_DROPPED",
		severity: "info",
		message: "Matched pairs containing an explicit null on either side were excluded."
	});
	const scale = commonScale(validPairs.map(([left]) => left.value), validPairs.map(([, right]) => right.value));
	const scaledDifferences = validPairs.map(([left, right]) => left.value / scale - right.value / scale);
	const rawDifferences = validPairs.map(([left, right]) => left.value - right.value);
	const rawDifferencesAreFinite = rawDifferences.every(Number.isFinite);
	const differences = rawDifferencesAreFinite ? rawDifferences : scaledDifferences;
	const outerDifferenceScale = rawDifferencesAreFinite ? 1 : scale;
	const described = describe(differences);
	const meanDifference = representableScaled(described.mean, outerDifferenceScale);
	if (meanDifference === null) diagnostics.push({
		code: "UNREPRESENTABLE_MEAN_DIFFERENCE",
		severity: "warning",
		message: "The finite-input paired mean difference exceeds the representable JavaScript range; scale-free inference remains available."
	});
	const cohensD = described.standardDeviationUnit === 0 ? null : described.meanUnit / described.standardDeviationUnit;
	if (cohensD === null) diagnostics.push({
		code: "ZERO_PAIRED_DIFFERENCE_VARIANCE",
		severity: "warning",
		message: "Paired Cohen's d is undefined because paired differences have zero sample variance."
	});
	const critical = studentTQuantile(input.alternative === "two-sided" ? 1 - .050000000000000044 / 2 : CONFIDENCE_LEVEL, validPairs.length - 1);
	const standardErrorUnit = described.standardDeviationUnit / Math.sqrt(validPairs.length);
	const finiteBound = (valueUnit, side) => {
		const inDifferenceUnits = representableScaled(valueUnit, described.scale);
		const value = inDifferenceUnits === null ? null : representableScaled(inDifferenceUnits, outerDifferenceScale);
		if (value !== null) return {
			kind: "finite",
			value
		};
		diagnostics.push({
			code: "UNREPRESENTABLE_CONFIDENCE_BOUND",
			severity: "warning",
			message: `The ${side} paired confidence bound exceeds the representable JavaScript range.`
		});
		return { kind: "unrepresentable" };
	};
	const lowerUnit = input.alternative === "less" ? null : described.meanUnit - critical * standardErrorUnit;
	const upperUnit = input.alternative === "greater" ? null : described.meanUnit + critical * standardErrorUnit;
	const confidenceInterval = {
		method: "paired-t-mean-difference-v1",
		confidenceLevel: CONFIDENCE_LEVEL,
		alternative: input.alternative,
		lower: lowerUnit === null ? { kind: "negative-infinity" } : finiteBound(lowerUnit, "lower"),
		upper: upperUnit === null ? { kind: "positive-infinity" } : finiteBound(upperUnit, "upper")
	};
	const signed = signedRank(differences, input.alternative, diagnostics);
	const raw = [signed.result.pValue];
	const adjusted = adjustPValues(raw, input.adjustment);
	return deepFreeze$4({
		schemaVersion: "3dena.stats.paired-result.v1",
		design: "paired",
		direction: "A-minus-B",
		contract: STATS_V1_CONTRACT,
		alternative: input.alternative,
		matching: {
			sideAInput: input.sideA.observations.length,
			sideBInput: input.sideB.observations.length,
			matched: matched.length,
			validPairs: validPairs.length,
			droppedMissingPairs,
			unmatchedA,
			unmatchedB,
			zeroDifferences: signed.zeroCount,
			rankedPairs: validPairs.length - signed.zeroCount
		},
		estimates: {
			meanDifference,
			confidenceInterval
		},
		wilcoxonSignedRank: signed.result,
		effects: {
			cohensD,
			rankBiserial: signed.rankBiserial
		},
		adjustment: {
			method: input.adjustment,
			raw,
			adjusted
		},
		diagnostics
	});
}
//#endregion
//#region packages/stats/src/rank-v2.ts
var RANK_INFERENCE_CONTRACT_V2 = Object.freeze({
	schemaVersion: "3dena.stats.rank-contract.v2",
	alternative: "two-sided",
	pValueMethod: "auto-exact-first",
	zeroMethod: "wilcox-drop-exact-zero",
	adjustment: "holm-complete-planned-family-v2",
	rankPrecisionSignificantDigits: 12,
	exactMaxRankedN: 50,
	friedmanExactAssignmentLimit: 1e6,
	continuityCorrection: .5,
	exactTail: "inclusive-non-mid-p"
});
function normalizeRankValue(value, path) {
	if (!Number.isFinite(value)) reject$5("NON_FINITE_RANK_VALUE", path, "must be finite");
	const rounded = Number(value.toPrecision(RANK_INFERENCE_CONTRACT_V2.rankPrecisionSignificantDigits));
	return Object.is(rounded, -0) ? 0 : rounded;
}
function summarizeType7(values, path) {
	const sorted = values.map((value, index) => normalizeRankValue(value, `${path}[${index}]`)).sort((left, right) => left - right);
	const quantile = (probability) => {
		if (sorted.length === 0) return null;
		const position = (sorted.length - 1) * probability;
		const lowerIndex = Math.floor(position);
		const upperIndex = Math.ceil(position);
		const lower = sorted[lowerIndex];
		const upper = sorted[upperIndex];
		return lower + (position - lowerIndex) * (upper - lower);
	};
	const q1 = quantile(.25);
	const q3 = quantile(.75);
	return {
		median: quantile(.5),
		q1,
		q3,
		iqr: q1 === null || q3 === null ? null : q3 - q1
	};
}
function averageRanks(values, path) {
	const ordered = values.map((value, index) => ({
		value: normalizeRankValue(value, `${path}[${index}]`),
		index
	})).sort((left, right) => left.value - right.value || left.index - right.index);
	const ranks = Array(ordered.length);
	let tieGroupCount = 0;
	let tiedObservationCount = 0;
	let tieCorrectionSum = 0;
	for (let start = 0; start < ordered.length;) {
		let end = start + 1;
		while (end < ordered.length && ordered[end].value === ordered[start].value) end += 1;
		const averageRank = (start + 1 + end) / 2;
		for (let index = start; index < end; index += 1) ranks[ordered[index].index] = averageRank;
		const tieSize = end - start;
		if (tieSize > 1) {
			tieGroupCount += 1;
			tiedObservationCount += tieSize;
			tieCorrectionSum += tieSize ** 3 - tieSize;
		}
		start = end;
	}
	return {
		ranks,
		doubledRanks: ranks.map((rank) => Math.round(rank * 2)),
		tieGroupCount,
		tiedObservationCount,
		tieCorrectionSum
	};
}
var LANCZOS_COEFFICIENTS = [
	676.5203681218851,
	-1259.1392167224028,
	771.3234287776531,
	-176.6150291621406,
	12.507343278686905,
	-.13857109526572012,
	9984369578019572e-21,
	1.5056327351493116e-7
];
function logGamma(value) {
	if (value < .5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
	const shifted = value - 1;
	let sum = .9999999999998099;
	for (const [index, coefficient] of LANCZOS_COEFFICIENTS.entries()) sum += coefficient / (shifted + index + 1);
	const t = shifted + LANCZOS_COEFFICIENTS.length - .5;
	return .5 * Math.log(2 * Math.PI) + (shifted + .5) * Math.log(t) - t + Math.log(sum);
}
function regularizedGammaQ(shape, x) {
	if (!Number.isFinite(shape) || shape <= 0 || Number.isNaN(x) || x < 0) reject$5("INVALID_GAMMA_INPUT", "rank", "requires shape > 0 and x >= 0");
	if (x === 0) return 1;
	if (x === Number.POSITIVE_INFINITY) return 0;
	const epsilon = 1e-15;
	const minimum = 1e-300;
	const logScale = -x + shape * Math.log(x) - logGamma(shape);
	if (x < shape + 1) {
		let term = 1 / shape;
		let sum = term;
		let denominator = shape;
		for (let iteration = 1; iteration <= 1e4; iteration += 1) {
			denominator += 1;
			term *= x / denominator;
			sum += term;
			if (Math.abs(term) <= Math.abs(sum) * epsilon) break;
		}
		return Math.max(0, Math.min(1, 1 - sum * Math.exp(logScale)));
	}
	let b = x + 1 - shape;
	let c = 1 / minimum;
	let d = 1 / Math.max(Math.abs(b), minimum);
	if (b < 0) d = -d;
	let fraction = d;
	for (let iteration = 1; iteration <= 1e4; iteration += 1) {
		const coefficient = -iteration * (iteration - shape);
		b += 2;
		d = coefficient * d + b;
		if (Math.abs(d) < minimum) d = minimum;
		c = b + coefficient / c;
		if (Math.abs(c) < minimum) c = minimum;
		d = 1 / d;
		const delta = d * c;
		fraction *= delta;
		if (Math.abs(delta - 1) <= epsilon) break;
	}
	return Math.max(0, Math.min(1, Math.exp(logScale) * fraction));
}
function probabilityFromCounts(extreme, total) {
	if (total <= 0n || total > BigInt(Number.MAX_SAFE_INTEGER) || extreme < 0n || extreme > total) reject$5("EXACT_COUNT_LIMIT", "rank.exactTail", "assignment counts exceed the supported safe ratio range");
	return Number(extreme) / Number(total);
}
function exactFixedSizeRankTail(doubledRanks, selectedSize, observedDoubledRankSum) {
	const distributions = Array.from({ length: selectedSize + 1 }, () => /* @__PURE__ */ new Map());
	distributions[0].set(0, 1n);
	let processed = 0;
	for (const rank of doubledRanks) {
		processed += 1;
		for (let picked = Math.min(selectedSize, processed); picked >= 1; picked -= 1) for (const [score, count] of distributions[picked - 1]) {
			const nextScore = score + rank;
			distributions[picked].set(nextScore, (distributions[picked].get(nextScore) ?? 0n) + count);
		}
	}
	const nullCenter = selectedSize * (doubledRanks.length + 1);
	const observedDistance = Math.abs(observedDoubledRankSum - nullCenter);
	let total = 0n;
	let extreme = 0n;
	for (const [score, count] of distributions[selectedSize]) {
		total += count;
		if (Math.abs(score - nullCenter) >= observedDistance) extreme += count;
	}
	return {
		extremeAssignmentCount: extreme.toString(),
		totalAssignmentCount: total.toString(),
		inclusive: true,
		midP: false,
		pValue: probabilityFromCounts(extreme, total)
	};
}
function mannWhitneyWarnings(nA, nB, exact, ties) {
	const warnings = [];
	if (nA < 10 || nB < 10) warnings.push("small-sample");
	if (exact) warnings.push("discrete-attainable-p");
	if (ties) warnings.push("ties-present");
	return warnings;
}
function mannWhitneyRankTestV2(primaryValues, secondaryValues) {
	const primary = primaryValues.map((value, index) => normalizeRankValue(value, `primary[${index}]`));
	const secondary = secondaryValues.map((value, index) => normalizeRankValue(value, `secondary[${index}]`));
	const nPrimary = primary.length;
	const nSecondary = secondary.length;
	const medianPrimary = summarizeType7(primary, "primary").median;
	const medianSecondary = summarizeType7(secondary, "secondary").median;
	if (nPrimary === 0 || nSecondary === 0) return deepFreeze$4({
		schemaVersion: "3dena.stats.mann-whitney.v2",
		status: "not-estimable",
		reason: "empty-group",
		nPrimary,
		nSecondary,
		medianPrimary,
		medianSecondary,
		uPrimary: null,
		uSecondary: null,
		z: null,
		pValueTwoSided: null,
		rankBiserialPrimaryVsSecondary: null,
		resolvedPMethod: null,
		continuityCorrectionApplied: false,
		tieGroupCount: 0,
		tiedObservationCount: 0,
		tieCorrectionSum: 0,
		exactTail: null,
		warnings: mannWhitneyWarnings(nPrimary, nSecondary, false, false)
	});
	const ranked = averageRanks([...primary, ...secondary], "pooled");
	const uPrimary = ranked.ranks.slice(0, nPrimary).reduce((sum, rank) => sum + rank, 0) - nPrimary * (nPrimary + 1) / 2;
	const uSecondary = nPrimary * nSecondary - uPrimary;
	const rankBiserialPrimaryVsSecondary = 2 * uPrimary / (nPrimary * nSecondary) - 1;
	const total = nPrimary + nSecondary;
	const variance = nPrimary * nSecondary / 12 * (total + 1 - ranked.tieCorrectionSum / (total * (total - 1)));
	if (!(variance > 0) || !Number.isFinite(variance)) return deepFreeze$4({
		schemaVersion: "3dena.stats.mann-whitney.v2",
		status: "not-estimable",
		reason: "all-values-tied",
		nPrimary,
		nSecondary,
		medianPrimary,
		medianSecondary,
		uPrimary,
		uSecondary,
		z: null,
		pValueTwoSided: null,
		rankBiserialPrimaryVsSecondary,
		resolvedPMethod: null,
		continuityCorrectionApplied: false,
		tieGroupCount: ranked.tieGroupCount,
		tiedObservationCount: ranked.tiedObservationCount,
		tieCorrectionSum: ranked.tieCorrectionSum,
		exactTail: null,
		warnings: mannWhitneyWarnings(nPrimary, nSecondary, false, ranked.tieGroupCount > 0)
	});
	const expectedU = nPrimary * nSecondary / 2;
	const correction = Math.sign(uPrimary - expectedU) * RANK_INFERENCE_CONTRACT_V2.continuityCorrection;
	const z = (uPrimary - expectedU - correction) / Math.sqrt(variance);
	const useExact = total <= RANK_INFERENCE_CONTRACT_V2.exactMaxRankedN;
	let pValueTwoSided;
	let resolvedPMethod;
	let exactTail = null;
	if (useExact) {
		const observedRankSum = nPrimary <= nSecondary ? ranked.doubledRanks.slice(0, nPrimary).reduce((sum, rank) => sum + rank, 0) : ranked.doubledRanks.slice(nPrimary).reduce((sum, rank) => sum + rank, 0);
		const exact = exactFixedSizeRankTail(ranked.doubledRanks, Math.min(nPrimary, nSecondary), observedRankSum);
		pValueTwoSided = exact.pValue;
		exactTail = {
			extremeAssignmentCount: exact.extremeAssignmentCount,
			totalAssignmentCount: exact.totalAssignmentCount,
			inclusive: true,
			midP: false
		};
		resolvedPMethod = ranked.tieGroupCount === 0 ? "exact-classic" : "exact-conditional-rank-permutation";
	} else {
		pValueTwoSided = regularizedGammaQ(.5, z * z / 2);
		resolvedPMethod = "normal-approximation-tie-corrected";
	}
	return deepFreeze$4({
		schemaVersion: "3dena.stats.mann-whitney.v2",
		status: "available",
		reason: null,
		nPrimary,
		nSecondary,
		medianPrimary,
		medianSecondary,
		uPrimary,
		uSecondary,
		z,
		pValueTwoSided,
		rankBiserialPrimaryVsSecondary,
		resolvedPMethod,
		continuityCorrectionApplied: !useExact,
		tieGroupCount: ranked.tieGroupCount,
		tiedObservationCount: ranked.tiedObservationCount,
		tieCorrectionSum: ranked.tieCorrectionSum,
		exactTail,
		warnings: mannWhitneyWarnings(nPrimary, nSecondary, useExact, ranked.tieGroupCount > 0)
	});
}
function exactSignFlipTail(doubledRanks, observedPositiveDoubledRankSum) {
	const distribution = /* @__PURE__ */ new Map([[0, 1n]]);
	for (const rank of doubledRanks) for (const [score, count] of [...distribution.entries()]) {
		const next = score + rank;
		distribution.set(next, (distribution.get(next) ?? 0n) + count);
	}
	const totalRank = doubledRanks.reduce((sum, rank) => sum + rank, 0);
	const observedDistance = Math.abs(2 * observedPositiveDoubledRankSum - totalRank);
	let total = 0n;
	let extreme = 0n;
	for (const [score, count] of distribution) {
		total += count;
		if (Math.abs(2 * score - totalRank) >= observedDistance) extreme += count;
	}
	return {
		extremeAssignmentCount: extreme.toString(),
		totalAssignmentCount: total.toString(),
		inclusive: true,
		midP: false,
		pValue: probabilityFromCounts(extreme, total)
	};
}
function minimumAttainableTwoSidedP(nNonzero) {
	if (nNonzero === 0) return null;
	return {
		formula: "2^(1-nNonzero)",
		log2: 1 - nNonzero,
		numeric: nNonzero <= 1075 ? 2 ** (1 - nNonzero) : null
	};
}
function wilcoxonWarnings(nNonzero, exact, ties, zeros, missing, available) {
	const warnings = [];
	if (nNonzero < 10) warnings.push("small-sample");
	if (available && exact) warnings.push("discrete-attainable-p");
	if (ties) warnings.push("ties-present");
	if (zeros) warnings.push("zero-differences-present");
	if (missing) warnings.push("missing-pairs");
	if (available) warnings.push("signed-rank-symmetry-assumption");
	return warnings;
}
function wilcoxonSignedRankTestV2(rawDifferencesLaterMinusEarlier, options = {}) {
	const nMissing = options.missingPairs ?? 0;
	if (!Number.isSafeInteger(nMissing) || nMissing < 0) reject$5("INVALID_MISSING_PAIR_COUNT", "options.missingPairs", "must be a non-negative safe integer");
	const differences = rawDifferencesLaterMinusEarlier.map((value, index) => normalizeRankValue(value, `differences[${index}]`));
	const nMatched = differences.length;
	const nPositive = differences.filter((difference) => difference > 0).length;
	const nNegative = differences.filter((difference) => difference < 0).length;
	const nZero = nMatched - nPositive - nNegative;
	const nonzero = differences.filter((difference) => difference !== 0);
	const nNonzero = nonzero.length;
	const summary = summarizeType7(differences, "differences");
	if (nNonzero === 0) return deepFreeze$4({
		schemaVersion: "3dena.stats.wilcoxon-signed-rank.v2",
		status: "not-estimable",
		reason: nMatched === 0 ? "insufficient-ranked-observations" : "all-zero-differences",
		nMatched,
		nMissing,
		nPositive,
		nNegative,
		nZero,
		nNonzero,
		nRanked: 0,
		medianDifference: summary.median,
		q1Difference: summary.q1,
		q3Difference: summary.q3,
		iqrDifference: summary.iqr,
		wPositive: null,
		wNegative: null,
		t: null,
		z: null,
		pValueTwoSided: null,
		rankBiserialLaterVsEarlier: null,
		resolvedPMethod: null,
		continuityCorrectionApplied: false,
		tieGroupCount: 0,
		tiedObservationCount: 0,
		tieCorrectionSum: 0,
		exactTail: null,
		minimumAttainableTwoSidedP: null,
		warnings: wilcoxonWarnings(0, false, false, nZero > 0, nMissing > 0, false)
	});
	const ranked = averageRanks(nonzero.map(Math.abs), "absoluteDifferences");
	let wPositive = 0;
	let wNegative = 0;
	for (let index = 0; index < nonzero.length; index += 1) if (nonzero[index] > 0) wPositive += ranked.ranks[index];
	else wNegative += ranked.ranks[index];
	const totalRank = wPositive + wNegative;
	const expected = totalRank / 2;
	const variance = ranked.ranks.reduce((sum, rank) => sum + rank * rank, 0) / 4;
	const correction = Math.sign(wPositive - expected) * RANK_INFERENCE_CONTRACT_V2.continuityCorrection;
	const z = (wPositive - expected - correction) / Math.sqrt(variance);
	const useExact = nNonzero <= RANK_INFERENCE_CONTRACT_V2.exactMaxRankedN;
	let pValueTwoSided;
	let resolvedPMethod;
	let exactTail = null;
	if (useExact) {
		const exact = exactSignFlipTail(ranked.doubledRanks, Math.round(wPositive * 2));
		pValueTwoSided = exact.pValue;
		exactTail = {
			extremeAssignmentCount: exact.extremeAssignmentCount,
			totalAssignmentCount: exact.totalAssignmentCount,
			inclusive: true,
			midP: false
		};
		resolvedPMethod = ranked.tieGroupCount === 0 && nZero === 0 ? "exact-classic" : "exact-conditional-sign-flip";
	} else {
		pValueTwoSided = regularizedGammaQ(.5, z * z / 2);
		resolvedPMethod = "normal-approximation-actual-ranks";
	}
	return deepFreeze$4({
		schemaVersion: "3dena.stats.wilcoxon-signed-rank.v2",
		status: "available",
		reason: null,
		nMatched,
		nMissing,
		nPositive,
		nNegative,
		nZero,
		nNonzero,
		nRanked: nNonzero,
		medianDifference: summary.median,
		q1Difference: summary.q1,
		q3Difference: summary.q3,
		iqrDifference: summary.iqr,
		wPositive,
		wNegative,
		t: Math.min(wPositive, wNegative),
		z,
		pValueTwoSided,
		rankBiserialLaterVsEarlier: (wPositive - wNegative) / totalRank,
		resolvedPMethod,
		continuityCorrectionApplied: !useExact,
		tieGroupCount: ranked.tieGroupCount,
		tiedObservationCount: ranked.tiedObservationCount,
		tieCorrectionSum: ranked.tieCorrectionSum,
		exactTail,
		minimumAttainableTwoSidedP: minimumAttainableTwoSidedP(nNonzero),
		warnings: wilcoxonWarnings(nNonzero, useExact, ranked.tieGroupCount > 0, nZero > 0, nMissing > 0, true)
	});
}
function factorial(value) {
	let output = 1n;
	for (let factor = 2; factor <= value; factor += 1) output *= BigInt(factor);
	return output;
}
function cappedAssignmentCount(base, exponent, limit) {
	let output = 1n;
	for (let index = 0; index < exponent; index += 1) {
		output *= base;
		if (output > limit) return limit + 1n;
	}
	return output;
}
function weightedRankPermutations(doubledRanks) {
	const counts = /* @__PURE__ */ new Map();
	for (const rank of doubledRanks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
	const distinct = [...counts.keys()].sort((left, right) => left - right);
	const multiplicity = [...counts.values()].reduce((product, count) => product * factorial(count), 1n);
	const output = [];
	const current = Array(doubledRanks.length);
	const visit = (position) => {
		if (position === current.length) {
			output.push({
				scores: [...current],
				multiplicity
			});
			return;
		}
		for (const rank of distinct) {
			const remaining = counts.get(rank) ?? 0;
			if (remaining === 0) continue;
			counts.set(rank, remaining - 1);
			current[position] = rank;
			visit(position + 1);
			counts.set(rank, remaining);
		}
	};
	visit(0);
	return output;
}
function friedmanScore(rankSums, nComplete, nPeriods) {
	const center = nComplete * (nPeriods + 1);
	return rankSums.reduce((sum, rankSum) => sum + (rankSum - center) ** 2, 0);
}
function exactFriedmanTail(ranksByBlock, observedRankSums) {
	const nPeriods = observedRankSums.length;
	let states = /* @__PURE__ */ new Map([[Array(nPeriods).fill(0).join(","), {
		sums: Array(nPeriods).fill(0),
		count: 1n
	}]]);
	for (const blockRanks of ranksByBlock) {
		const permutations = weightedRankPermutations(blockRanks);
		const next = /* @__PURE__ */ new Map();
		for (const state of states.values()) for (const permutation of permutations) {
			const sums = state.sums.map((sum, index) => sum + permutation.scores[index]);
			const key = sums.join(",");
			const count = state.count * permutation.multiplicity;
			const existing = next.get(key);
			if (existing) existing.count += count;
			else next.set(key, {
				sums,
				count
			});
		}
		states = next;
	}
	const observedScore = friedmanScore(observedRankSums, ranksByBlock.length, nPeriods);
	let total = 0n;
	let extreme = 0n;
	for (const state of states.values()) {
		total += state.count;
		if (friedmanScore(state.sums, ranksByBlock.length, nPeriods) >= observedScore) extreme += state.count;
	}
	return {
		extremeAssignmentCount: extreme.toString(),
		totalAssignmentCount: total.toString(),
		inclusive: true,
		midP: false,
		pValue: probabilityFromCounts(extreme, total)
	};
}
function friedmanWarnings(nComplete, exact, ties, missing, available) {
	const warnings = [];
	if (nComplete < 10) warnings.push("small-sample");
	if (available && exact) warnings.push("discrete-attainable-p");
	if (ties) warnings.push("ties-present");
	if (missing) warnings.push("missing-complete-blocks");
	return warnings;
}
function friedmanRankTestV2(completeBlocksByPeriod, options = {}) {
	const nComplete = completeBlocksByPeriod.length;
	const nMissingCompleteBlocks = options.missingCompleteBlocks ?? 0;
	if (!Number.isSafeInteger(nMissingCompleteBlocks) || nMissingCompleteBlocks < 0) reject$5("INVALID_MISSING_BLOCK_COUNT", "options.missingCompleteBlocks", "must be a non-negative safe integer");
	const periodCountWhenEmpty = options.periodCountWhenEmpty ?? 0;
	if (!Number.isSafeInteger(periodCountWhenEmpty) || periodCountWhenEmpty < 0) reject$5("INVALID_PERIOD_COUNT", "options.periodCountWhenEmpty", "must be a non-negative safe integer");
	const nPeriods = nComplete > 0 ? completeBlocksByPeriod[0].length : periodCountWhenEmpty;
	const unavailable = (reason, degreesFreedom, tieAudit = {
		tieGroupCount: 0,
		tiedObservationCount: 0,
		tieCorrectionSum: 0
	}) => deepFreeze$4({
		schemaVersion: "3dena.stats.friedman.v2",
		status: "not-estimable",
		reason,
		nComplete,
		nMissingCompleteBlocks,
		nPeriods,
		q: null,
		degreesFreedom,
		kendallsW: null,
		pValueUpperTail: null,
		resolvedPMethod: null,
		...tieAudit,
		exactTail: null,
		warnings: friedmanWarnings(nComplete, false, tieAudit.tieGroupCount > 0, nMissingCompleteBlocks > 0, false)
	});
	if (nComplete === 0) return unavailable("no-complete-blocks", nPeriods >= 1 ? nPeriods - 1 : null);
	if (nPeriods < 3) return unavailable("insufficient-ranked-observations", nPeriods >= 1 ? nPeriods - 1 : null);
	if (completeBlocksByPeriod.some((block) => block.length !== nPeriods)) reject$5("ENTITY_PERIOD_INSTABILITY", "completeBlocksByPeriod", "every complete block must have the same period count");
	const ranksByBlock = [];
	const observedRankSums = Array(nPeriods).fill(0);
	let tieGroupCount = 0;
	let tiedObservationCount = 0;
	let tieCorrectionSum = 0;
	for (const [blockIndex, block] of completeBlocksByPeriod.entries()) {
		const ranked = averageRanks(block, `completeBlocksByPeriod[${blockIndex}]`);
		ranksByBlock.push(ranked.doubledRanks);
		for (let period = 0; period < nPeriods; period += 1) observedRankSums[period] = observedRankSums[period] + ranked.doubledRanks[period];
		tieGroupCount += ranked.tieGroupCount;
		tiedObservationCount += ranked.tiedObservationCount;
		tieCorrectionSum += ranked.tieCorrectionSum;
	}
	const tieAudit = {
		tieGroupCount,
		tiedObservationCount,
		tieCorrectionSum
	};
	const denominator = nComplete * nPeriods * (nPeriods + 1) - tieCorrectionSum / (nPeriods - 1);
	if (!(denominator > 0) || !Number.isFinite(denominator)) return unavailable("all-values-tied", nPeriods - 1, tieAudit);
	const q = 3 * friedmanScore(observedRankSums, nComplete, nPeriods) / denominator;
	const degreesFreedom = nPeriods - 1;
	const kendallsW = Math.max(0, Math.min(1, q / (nComplete * degreesFreedom)));
	const limit = BigInt(RANK_INFERENCE_CONTRACT_V2.friedmanExactAssignmentLimit);
	const useExact = cappedAssignmentCount(factorial(nPeriods), nComplete, limit) <= limit;
	let pValueUpperTail;
	let resolvedPMethod;
	let exactTail = null;
	if (useExact) {
		const exact = exactFriedmanTail(ranksByBlock, observedRankSums);
		pValueUpperTail = exact.pValue;
		exactTail = {
			extremeAssignmentCount: exact.extremeAssignmentCount,
			totalAssignmentCount: exact.totalAssignmentCount,
			inclusive: true,
			midP: false
		};
		resolvedPMethod = "exact-conditional-period-permutation";
	} else {
		pValueUpperTail = regularizedGammaQ(degreesFreedom / 2, q / 2);
		resolvedPMethod = "chi-square-approximation-tie-corrected";
	}
	return deepFreeze$4({
		schemaVersion: "3dena.stats.friedman.v2",
		status: "available",
		reason: null,
		nComplete,
		nMissingCompleteBlocks,
		nPeriods,
		q,
		degreesFreedom,
		kendallsW,
		pValueUpperTail,
		resolvedPMethod,
		...tieAudit,
		exactTail,
		warnings: friedmanWarnings(nComplete, useExact, tieGroupCount > 0, nMissingCompleteBlocks > 0, true)
	});
}
function holmAdjustFamilyV2(members) {
	const identifiers = /* @__PURE__ */ new Set();
	for (const [index, member] of members.entries()) {
		if (!member.memberId || identifiers.has(member.memberId)) reject$5("INVALID_HOLM_MEMBER_ID", `members[${index}].memberId`, "must be non-empty and unique");
		identifiers.add(member.memberId);
		if (member.pRaw !== null && (!Number.isFinite(member.pRaw) || member.pRaw < 0 || member.pRaw > 1)) reject$5("INVALID_HOLM_P_VALUE", `members[${index}].pRaw`, "must be null or finite in [0, 1]");
	}
	const familySizePlanned = members.length;
	const ordered = members.map((member, originalIndex) => ({
		...member,
		originalIndex,
		effectiveP: member.pRaw ?? 1
	})).sort((left, right) => left.effectiveP - right.effectiveP || left.memberId.localeCompare(right.memberId));
	const byOriginal = Array(familySizePlanned);
	let runningMaximum = 0;
	for (const [index, member] of ordered.entries()) {
		const multiplier = familySizePlanned - index;
		runningMaximum = Math.min(1, Math.max(runningMaximum, multiplier * member.effectiveP));
		byOriginal[member.originalIndex] = {
			memberId: member.memberId,
			pRaw: member.pRaw,
			pHolm: member.pRaw === null ? null : runningMaximum,
			familySizePlanned,
			holmRank: member.pRaw === null ? null : index + 1,
			holmMultiplier: member.pRaw === null ? null : multiplier
		};
	}
	return deepFreeze$4(byOriginal);
}
//#endregion
//#region packages/trajectory/src/errors.ts
var TrajectoryDynamicsError = class extends Error {
	code;
	path;
	constructor(code, path, message) {
		super(`${path}: ${message}`);
		this.name = "TrajectoryDynamicsError";
		this.code = code;
		this.path = path;
	}
};
function rejectTrajectoryDynamics(code, path, message) {
	throw new TrajectoryDynamicsError(code, path, message);
}
//#endregion
//#region packages/trajectory/src/analyze.ts
var DEFAULT_LIMITS$1 = Object.freeze({
	maxPoints: 1e5,
	maxDimensions: 200,
	maxPeriods: 1e3,
	maxParticipants: 5e4,
	maxCells: 5e6
});
var HARD_LIMITS$1 = Object.freeze({
	maxPoints: 5e5,
	maxDimensions: 500,
	maxPeriods: 1e4,
	maxParticipants: 2e5,
	maxCells: 1e8
});
var DURATION_MILLISECONDS = Object.freeze({
	milliseconds: 1,
	seconds: 1e3,
	minutes: 6e4,
	hours: 36e5,
	days: 864e5,
	weeks: 6048e5
});
var INT64_MIN = -(1n << 63n);
var INT64_MAX = (1n << 63n) - 1n;
function resolveLimits$1(input) {
	const output = {};
	for (const key of Object.keys(DEFAULT_LIMITS$1)) {
		const value = input?.[key];
		if (value !== void 0 && (!Number.isSafeInteger(value) || value < 1)) rejectTrajectoryDynamics("INVALID_TRAJECTORY_LIMIT", `input.limits.${key}`, "must be a positive safe integer");
		if (value !== void 0 && value > HARD_LIMITS$1[key]) rejectTrajectoryDynamics("TRAJECTORY_LIMIT_ABOVE_CEILING", `input.limits.${key}`, `must not exceed ${HARD_LIMITS$1[key]}`);
		output[key] = value ?? DEFAULT_LIMITS$1[key];
	}
	return output;
}
function finiteDoubleBits$1(value) {
	const view = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(8));
	view.setFloat64(0, value, false);
	return view.getBigUint64(0, false).toString(16).padStart(16, "0");
}
function identityToken$1(component, path) {
	if (!component || typeof component !== "object") rejectTrajectoryDynamics("INVALID_IDENTITY_COMPONENT", path, "must be an object");
	if (typeof component.name !== "string" || component.name.trim() === "" || component.name.length > 256) rejectTrajectoryDynamics("INVALID_IDENTITY_COMPONENT", `${path}.name`, "must be a non-empty string of at most 256 UTF-16 code units");
	if (component.declaredType !== void 0 && (typeof component.declaredType !== "string" || component.declaredType.trim() === "" || component.declaredType.length > 256)) rejectTrajectoryDynamics("INVALID_IDENTITY_COMPONENT", `${path}.declaredType`, "must be a non-empty string of at most 256 UTF-16 code units when present");
	if (component.type === "string") {
		if (typeof component.value !== "string" || component.value.length === 0) rejectTrajectoryDynamics("INVALID_IDENTITY_VALUE", `${path}.value`, "must be a non-empty string for a string component");
		return [
			component.name,
			"string",
			component.declaredType ?? "string",
			component.value
		];
	}
	if (component.type === "boolean") {
		if (typeof component.value !== "boolean") rejectTrajectoryDynamics("INVALID_IDENTITY_VALUE", `${path}.value`, "must be boolean for a boolean component");
		return [
			component.name,
			"boolean",
			component.declaredType ?? "boolean",
			component.value ? "true" : "false"
		];
	}
	if (component.type !== "number" || typeof component.value !== "number" || !Number.isFinite(component.value)) rejectTrajectoryDynamics("INVALID_IDENTITY_VALUE", `${path}.value`, "must be a finite number for a number component");
	if (Number.isInteger(component.value) && !Number.isSafeInteger(component.value)) rejectTrajectoryDynamics("UNSAFE_INTEGER_IDENTITY", `${path}.value`, "integer identities above Number.MAX_SAFE_INTEGER must be lossless strings");
	return [
		component.name,
		"number",
		component.declaredType ?? "double",
		finiteDoubleBits$1(component.value)
	];
}
function normalizeIdentity$2(identity, path) {
	if (!identity || !Array.isArray(identity.components) || identity.components.length === 0) rejectTrajectoryDynamics("INVALID_TRAJECTORY_IDENTITY", path, "must contain at least one typed component");
	const names = /* @__PURE__ */ new Set();
	const entries = identity.components.map((component, index) => {
		const token = identityToken$1(component, `${path}.components[${index}]`);
		if (names.has(component.name)) rejectTrajectoryDynamics("DUPLICATE_IDENTITY_COMPONENT", `${path}.components[${index}].name`, "duplicates an earlier component name");
		names.add(component.name);
		return {
			component: { ...component },
			token
		};
	});
	return {
		components: entries.map(({ component }) => component),
		canonical: JSON.stringify(entries.map(({ token }) => token)),
		display: entries.map(({ component }) => String(component.value)).join(" · ")
	};
}
function normalizeNamespace$1(value) {
	if (typeof value !== "string" || value.trim() === "" || value.length > 256) rejectTrajectoryDynamics("INVALID_TRAJECTORY_NAMESPACE", "input.namespace", "must be a non-empty string of at most 256 UTF-16 code units");
	return value;
}
function isDurationUnit(value) {
	return typeof value === "string" && Object.hasOwn(DURATION_MILLISECONDS, value);
}
function parseCivilDate(value, path) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) rejectTrajectoryDynamics("INVALID_TRAJECTORY_DATE", path, "must use strict YYYY-MM-DD syntax");
	const [yearText, monthText, dayText] = value.split("-");
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const date = /* @__PURE__ */ new Date(0);
	date.setUTCHours(0, 0, 0, 0);
	date.setUTCFullYear(year, month - 1, day);
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) rejectTrajectoryDynamics("INVALID_TRAJECTORY_DATE", path, "must be a real proleptic-Gregorian calendar date");
	return date.getTime() / DURATION_MILLISECONDS.days;
}
function parseInt64(value, path) {
	if (typeof value !== "string" || value.length > 20 || !/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") rejectTrajectoryDynamics("INVALID_INSTANT_EPOCH", path, "must be a canonical signed decimal integer string");
	const parsed = BigInt(value);
	if (parsed < INT64_MIN || parsed > INT64_MAX) rejectTrajectoryDynamics("INSTANT_EPOCH_OUT_OF_RANGE", path, "must fit signed int64 epoch milliseconds");
	return parsed;
}
function cloneTimeValue(value) {
	return { ...value };
}
function normalizeTimeValues(definitions, limits) {
	if (!Array.isArray(definitions) || definitions.length === 0) rejectTrajectoryDynamics("INVALID_TRAJECTORY_PERIODS", "input.periods", "must contain at least one expected period");
	if (definitions.length > limits.maxPeriods) rejectTrajectoryDynamics("TRAJECTORY_PERIOD_LIMIT", "input.periods", `exceeds maxPeriods=${limits.maxPeriods}`);
	const firstDefinition = definitions[0];
	if (!firstDefinition || typeof firstDefinition !== "object") rejectTrajectoryDynamics("INVALID_TRAJECTORY_PERIOD", "input.periods[0]", "must be an object");
	const first = firstDefinition.value;
	if (!first || typeof first !== "object") rejectTrajectoryDynamics("INVALID_TRAJECTORY_TIME_VALUE", "input.periods[0].value", "must be a versioned time value");
	let contract;
	if (first.type === "numeric-v1") {
		if (typeof first.unit !== "string" || first.unit.trim() === "" || first.unit.length > 128) rejectTrajectoryDynamics("INVALID_NUMERIC_TIME_UNIT", "input.periods[0].value.unit", "must be a non-empty label of at most 128 UTF-16 code units");
		contract = {
			kind: "numeric-v1",
			elapsedUnit: first.unit,
			chronology: "strictly-increasing-finite-number-v1"
		};
	} else if (first.type === "date-v1") contract = {
		kind: "date-v1",
		elapsedUnit: "days",
		calendar: "proleptic-gregorian-v1",
		chronology: "strictly-increasing-civil-day-v1"
	};
	else if (first.type === "instant-v1") {
		if (!isDurationUnit(first.elapsedUnit)) rejectTrajectoryDynamics("INVALID_INSTANT_ELAPSED_UNIT", "input.periods[0].value.elapsedUnit", "must be a supported fixed-duration unit");
		contract = {
			kind: "instant-v1",
			elapsedUnit: first.elapsedUnit,
			epoch: "unix-epoch-milliseconds-int64-v1",
			chronology: "strictly-increasing-exact-epoch-v1",
			zoneRole: "presentation-provenance-only"
		};
	} else if (first.type === "difftime-v1") {
		if (!isDurationUnit(first.elapsedUnit)) rejectTrajectoryDynamics("INVALID_DIFFTIME_ELAPSED_UNIT", "input.periods[0].value.elapsedUnit", "must be a supported fixed-duration unit");
		contract = {
			kind: "difftime-v1",
			elapsedUnit: first.elapsedUnit,
			conversion: "fixed-duration-unit-ratios-v1",
			chronology: "strictly-increasing-normalized-duration-v1"
		};
	} else rejectTrajectoryDynamics("UNKNOWN_TRAJECTORY_TIME_VERSION", "input.periods[0].value.type", "is not a supported versioned time type");
	const seen = /* @__PURE__ */ new Set();
	const periods = definitions.map((definition, index) => {
		if (!definition || typeof definition !== "object") rejectTrajectoryDynamics("INVALID_TRAJECTORY_PERIOD", `input.periods[${index}]`, "must be an object");
		const key = normalizeIdentity$2(definition.time, `input.periods[${index}].time`);
		if (seen.has(key.canonical)) rejectTrajectoryDynamics("DUPLICATE_TRAJECTORY_TIME", `input.periods[${index}].time`, "duplicates an earlier typed period identity");
		seen.add(key.canonical);
		const value = definition.value;
		if (!value || typeof value !== "object" || value.type !== contract.kind) rejectTrajectoryDynamics("MIXED_TRAJECTORY_TIME_TYPES", `input.periods[${index}].value`, `must use ${contract.kind} for every period`);
		let coordinate;
		if (value.type === "numeric-v1" && contract.kind === "numeric-v1") {
			if (typeof value.value !== "number" || !Number.isFinite(value.value)) rejectTrajectoryDynamics("INVALID_NUMERIC_TIME", `input.periods[${index}].value.value`, "must be finite");
			if (value.unit !== contract.elapsedUnit) rejectTrajectoryDynamics("MIXED_NUMERIC_TIME_UNITS", `input.periods[${index}].value.unit`, "must exactly match the first period unit");
			coordinate = value.value;
		} else if (value.type === "date-v1" && contract.kind === "date-v1") coordinate = parseCivilDate(value.value, `input.periods[${index}].value.value`);
		else if (value.type === "instant-v1" && contract.kind === "instant-v1") {
			if (value.elapsedUnit !== contract.elapsedUnit) rejectTrajectoryDynamics("MIXED_INSTANT_ELAPSED_UNITS", `input.periods[${index}].value.elapsedUnit`, "must exactly match the first period elapsedUnit");
			if (typeof value.timeZone !== "string" || value.timeZone.trim() === "" || value.timeZone.length > 256) rejectTrajectoryDynamics("INVALID_INSTANT_TIME_ZONE", `input.periods[${index}].value.timeZone`, "must be a non-empty provenance label of at most 256 UTF-16 code units");
			if (!Number.isInteger(value.offsetMinutes) || value.offsetMinutes < -840 || value.offsetMinutes > 840) rejectTrajectoryDynamics("INVALID_INSTANT_OFFSET", `input.periods[${index}].value.offsetMinutes`, "must be an integer in [-840, 840]");
			if (value.fold !== 0 && value.fold !== 1) rejectTrajectoryDynamics("INVALID_INSTANT_FOLD", `input.periods[${index}].value.fold`, "must be 0 or 1");
			coordinate = parseInt64(value.epochMilliseconds, `input.periods[${index}].value.epochMilliseconds`);
		} else if (value.type === "difftime-v1" && contract.kind === "difftime-v1") {
			if (typeof value.value !== "number" || !Number.isFinite(value.value)) rejectTrajectoryDynamics("INVALID_DIFFTIME_VALUE", `input.periods[${index}].value.value`, "must be finite");
			if (!isDurationUnit(value.unit) || !isDurationUnit(value.elapsedUnit)) rejectTrajectoryDynamics("INVALID_DIFFTIME_UNIT", `input.periods[${index}].value`, "unit and elapsedUnit must be supported fixed-duration units");
			if (value.elapsedUnit !== contract.elapsedUnit) rejectTrajectoryDynamics("MIXED_DIFFTIME_ELAPSED_UNITS", `input.periods[${index}].value.elapsedUnit`, "must exactly match the first period elapsedUnit");
			coordinate = value.value * (DURATION_MILLISECONDS[value.unit] / DURATION_MILLISECONDS[value.elapsedUnit]);
			if (!Number.isFinite(coordinate)) rejectTrajectoryDynamics("TRAJECTORY_TIME_OVERFLOW", `input.periods[${index}].value`, "normalized difftime is outside the finite numeric range");
		} else rejectTrajectoryDynamics("MIXED_TRAJECTORY_TIME_TYPES", `input.periods[${index}].value`, `must use ${contract.kind} for every period`);
		return {
			definition: {
				time: { components: key.components.map((component) => ({ ...component })) },
				value: cloneTimeValue(value)
			},
			key,
			coordinate
		};
	});
	const difference = (right, left, path) => {
		if (typeof right === "bigint" && typeof left === "bigint" && contract.kind === "instant-v1") {
			const deltaMilliseconds = right - left;
			if (deltaMilliseconds <= 0n) rejectTrajectoryDynamics("NON_INCREASING_TRAJECTORY_TIME", path, "period values must be strictly increasing");
			if (deltaMilliseconds > BigInt(Number.MAX_SAFE_INTEGER)) rejectTrajectoryDynamics("TRAJECTORY_TIME_PRECISION_LIMIT", path, "adjacent epoch difference exceeds exact JavaScript integer conversion");
			const output = Number(deltaMilliseconds) / DURATION_MILLISECONDS[contract.elapsedUnit];
			if (!Number.isFinite(output) || output <= 0) rejectTrajectoryDynamics("TRAJECTORY_TIME_OVERFLOW", path, "elapsed interval is outside the positive finite numeric range");
			return output;
		}
		if (typeof right !== "number" || typeof left !== "number") rejectTrajectoryDynamics("MIXED_TRAJECTORY_TIME_TYPES", path, "normalized coordinates must use one numeric representation");
		const output = right - left;
		if (!Number.isFinite(output)) rejectTrajectoryDynamics("TRAJECTORY_TIME_OVERFLOW", path, "elapsed interval is outside the finite numeric range");
		if (output <= 0) rejectTrajectoryDynamics("NON_INCREASING_TRAJECTORY_TIME", path, "period values must be strictly increasing");
		return output;
	};
	const elapsedFromPrevious = periods.map((period, index) => index === 0 ? null : difference(period.coordinate, periods[index - 1].coordinate, `input.periods[${index}].value`));
	const elapsedFromStart = periods.map((period, index) => index === 0 ? 0 : difference(period.coordinate, periods[0].coordinate, `input.periods[${index}].value`));
	return {
		periods,
		contract,
		elapsedFromPrevious,
		elapsedFromStart
	};
}
function normalizeInput(input) {
	if (!input || typeof input !== "object") rejectTrajectoryDynamics("INVALID_TRAJECTORY_INPUT", "input", "must be an object");
	if (input.schemaVersion !== "3dena.trajectory-dynamics-input.v1") rejectTrajectoryDynamics("UNKNOWN_TRAJECTORY_INPUT_VERSION", "input.schemaVersion", "must be 3dena.trajectory-dynamics-input.v1");
	const limits = resolveLimits$1(input.limits);
	const namespace = normalizeNamespace$1(input.namespace);
	if (!Array.isArray(input.dimensions) || input.dimensions.length === 0) rejectTrajectoryDynamics("INVALID_TRAJECTORY_DIMENSIONS", "input.dimensions", "must contain at least one dimension");
	if (input.dimensions.length > limits.maxDimensions) rejectTrajectoryDynamics("TRAJECTORY_DIMENSION_LIMIT", "input.dimensions", `exceeds maxDimensions=${limits.maxDimensions}`);
	if (input.dimensions.some((dimension) => typeof dimension !== "string" || dimension.trim() === "" || dimension.length > 256)) rejectTrajectoryDynamics("INVALID_TRAJECTORY_DIMENSIONS", "input.dimensions", "must contain non-empty strings of at most 256 UTF-16 code units");
	if (new Set(input.dimensions).size !== input.dimensions.length) rejectTrajectoryDynamics("DUPLICATE_TRAJECTORY_DIMENSION", "input.dimensions", "must be unique and ordered");
	if (!Array.isArray(input.selectedDimensions) || input.selectedDimensions.length !== 3 || new Set(input.selectedDimensions).size !== 3) rejectTrajectoryDynamics("INVALID_SELECTED_DIMENSIONS", "input.selectedDimensions", "must contain exactly three distinct dimensions");
	const selectedIndexes = input.selectedDimensions.map((dimension, index) => {
		const resolved = input.dimensions.indexOf(dimension);
		if (resolved < 0) rejectTrajectoryDynamics("UNKNOWN_SELECTED_DIMENSION", `input.selectedDimensions[${index}]`, `${JSON.stringify(dimension)} is not declared`);
		return resolved;
	});
	if (input.cohortPolicy !== "available" && input.cohortPolicy !== "complete") rejectTrajectoryDynamics("INVALID_TRAJECTORY_COHORT", "input.cohortPolicy", "must be available or complete");
	if (input.estimand?.kind !== "equal-participant-v1" && input.estimand?.kind !== "weighted-participant-v1") rejectTrajectoryDynamics("INVALID_TRAJECTORY_ESTIMAND", "input.estimand.kind", "must be equal-participant-v1 or weighted-participant-v1");
	const normalizedTime = normalizeTimeValues(input.periods, limits);
	if (!Array.isArray(input.points) || input.points.length === 0) rejectTrajectoryDynamics("EMPTY_TRAJECTORY_POINTS", "input.points", "must contain at least one preprojected point");
	if (input.points.length > limits.maxPoints) rejectTrajectoryDynamics("TRAJECTORY_POINT_LIMIT", "input.points", `exceeds maxPoints=${limits.maxPoints}`);
	const cells = input.points.length * input.dimensions.length;
	if (!Number.isSafeInteger(cells) || cells > limits.maxCells) rejectTrajectoryDynamics("TRAJECTORY_CELL_LIMIT", "input.points", `exceeds maxCells=${limits.maxCells}`);
	const expectedTimes = new Set(normalizedTime.periods.map(({ key }) => key.canonical));
	const points = input.points.map((point, rowIndex) => {
		if (!point || typeof point !== "object") rejectTrajectoryDynamics("INVALID_TRAJECTORY_POINT", `input.points[${rowIndex}]`, "must be an object");
		const participant = normalizeIdentity$2(point.participant, `input.points[${rowIndex}].participant`);
		const time = normalizeIdentity$2(point.time, `input.points[${rowIndex}].time`);
		if (!expectedTimes.has(time.canonical)) rejectTrajectoryDynamics("TRAJECTORY_TIME_ORDER_INCOMPLETE", `input.points[${rowIndex}].time`, "observed typed period is absent from input.periods");
		if (!Array.isArray(point.coordinates) || point.coordinates.length !== input.dimensions.length) rejectTrajectoryDynamics("TRAJECTORY_COORDINATE_SHAPE", `input.points[${rowIndex}].coordinates`, "must align exactly with dimensions");
		const coordinates = point.coordinates.map((value, dimensionIndex) => {
			if (typeof value !== "number" || !Number.isFinite(value)) rejectTrajectoryDynamics("NON_FINITE_TRAJECTORY_COORDINATE", `input.points[${rowIndex}].coordinates[${dimensionIndex}]`, "must be finite");
			return value;
		});
		if (point.weight !== void 0 && (typeof point.weight !== "number" || !Number.isFinite(point.weight) || point.weight <= 0)) rejectTrajectoryDynamics("INVALID_PARTICIPANT_WEIGHT", `input.points[${rowIndex}].weight`, "must be finite and strictly positive when present");
		if (input.estimand.kind === "weighted-participant-v1" && point.weight === void 0) rejectTrajectoryDynamics("MISSING_PARTICIPANT_WEIGHT", `input.points[${rowIndex}].weight`, "is required by weighted-participant-v1");
		return {
			participant,
			time,
			coordinates,
			...point.weight === void 0 ? {} : { weight: point.weight },
			rowIndex
		};
	});
	if (new Set(points.map(({ participant }) => participant.canonical)).size > limits.maxParticipants) rejectTrajectoryDynamics("TRAJECTORY_PARTICIPANT_LIMIT", "input.points", `exceeds maxParticipants=${limits.maxParticipants}`);
	return {
		input,
		namespace,
		dimensions: [...input.dimensions],
		selectedDimensions: [...input.selectedDimensions],
		selectedIndexes,
		periods: normalizedTime.periods,
		timeContract: normalizedTime.contract,
		elapsedFromPrevious: normalizedTime.elapsedFromPrevious,
		elapsedFromStart: normalizedTime.elapsedFromStart,
		points,
		limits
	};
}
function compareCanonical$1(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
function compensatedMean(rows, dimensions) {
	return Array.from({ length: dimensions }, (_, dimension) => {
		let sum = 0;
		let correction = 0;
		for (const row of rows) {
			const term = row[dimension] / rows.length;
			const next = sum + term;
			if (!Number.isFinite(next)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.mean[${dimension}]`, "centroid accumulation is outside the finite numeric range");
			correction += Math.abs(sum) >= Math.abs(term) ? sum - next + term : term - next + sum;
			if (!Number.isFinite(correction)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.mean[${dimension}]`, "centroid correction is outside the finite numeric range");
			sum = next;
		}
		const result = sum + correction;
		if (!Number.isFinite(result)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.mean[${dimension}]`, "centroid is outside the finite numeric range");
		return result;
	});
}
function reduceParticipantPeriods$1(series) {
	const grouped = /* @__PURE__ */ new Map();
	for (const point of series.points) {
		const key = JSON.stringify([
			series.namespace,
			point.participant.canonical,
			point.time.canonical
		]);
		const existing = grouped.get(key);
		if (existing) existing.rows.push(point);
		else grouped.set(key, {
			participant: point.participant,
			time: point.time,
			rows: [point]
		});
	}
	const expectedTimes = new Set(series.periods.map(({ key }) => key.canonical));
	const observedByParticipant = /* @__PURE__ */ new Map();
	for (const group of grouped.values()) {
		const observed = observedByParticipant.get(group.participant.canonical) ?? /* @__PURE__ */ new Set();
		observed.add(group.time.canonical);
		observedByParticipant.set(group.participant.canonical, observed);
	}
	const complete = new Set([...observedByParticipant.entries()].filter(([, observed]) => observed.size === expectedTimes.size).map(([participant]) => participant));
	const periodIndex = new Map(series.periods.map(({ key }, index) => [key.canonical, index]));
	let duplicateRows = 0;
	const weightsByParticipant = /* @__PURE__ */ new Map();
	const participantPeriods = [...grouped.values()].sort((left, right) => compareCanonical$1(left.participant.canonical, right.participant.canonical) || periodIndex.get(left.time.canonical) - periodIndex.get(right.time.canonical)).map((group, index) => {
		duplicateRows += group.rows.length - 1;
		const fullCoordinates = compensatedMean(group.rows.map(({ coordinates }) => coordinates), series.dimensions.length);
		let participantWeight = 1;
		if (series.input.estimand.kind === "weighted-participant-v1") {
			if (new Set(group.rows.map(({ weight }) => weight)).size !== 1) rejectTrajectoryDynamics("INCONSISTENT_PARTICIPANT_PERIOD_WEIGHT", `input.participantPeriods.${group.participant.display}.${group.time.display}`, "duplicate source rows must declare one constant participant-period weight");
			participantWeight = group.rows[0].weight;
		}
		const includedInCohort = series.input.cohortPolicy === "available" || complete.has(group.participant.canonical);
		if (series.input.estimand.kind === "weighted-participant-v1" && includedInCohort) {
			const participantWeights = weightsByParticipant.get(group.participant.canonical) ?? /* @__PURE__ */ new Set();
			participantWeights.add(participantWeight);
			weightsByParticipant.set(group.participant.canonical, participantWeights);
		}
		return {
			index,
			participant: group.participant,
			time: group.time,
			selectedCoordinates: series.selectedIndexes.map((selected) => fullCoordinates[selected]),
			fullCoordinates,
			sourceRowIndexes: group.rows.map(({ rowIndex }) => rowIndex).sort((left, right) => left - right),
			participantWeight,
			includedInCohort
		};
	});
	const cohortExcludedParticipants = series.input.cohortPolicy === "complete" ? observedByParticipant.size - complete.size : 0;
	const timeVaryingWeights = [...weightsByParticipant.values()].filter((weights) => weights.size > 1).length;
	return {
		participantPeriods,
		duplicateRows,
		cohortExcludedParticipants,
		timeVaryingWeights
	};
}
function finiteWeightedCentroid(rows, dimensions, weighted) {
	if (rows.length === 0) return {
		centroid: null,
		weightSum: null,
		effectiveParticipantN: null
	};
	if (!weighted) return {
		centroid: compensatedMean(rows.map(({ fullCoordinates }) => fullCoordinates), dimensions),
		weightSum: rows.length,
		effectiveParticipantN: rows.length
	};
	const maximumWeight = rows.reduce((maximum, { participantWeight }) => Math.max(maximum, participantWeight), 0);
	const scaledWeights = rows.map(({ participantWeight }) => participantWeight / maximumWeight);
	const scaledWeightSum = scaledWeights.reduce((sum, value) => sum + value, 0);
	const squaredScaledWeightSum = scaledWeights.reduce((sum, value) => sum + value * value, 0);
	if (!Number.isFinite(scaledWeightSum) || scaledWeightSum <= 0 || !Number.isFinite(squaredScaledWeightSum) || squaredScaledWeightSum <= 0) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.weights", "normalized participant weights are not representable");
	const centroid = Array.from({ length: dimensions }, (_, dimension) => {
		let sum = 0;
		let correction = 0;
		rows.forEach((row, index) => {
			const term = row.fullCoordinates[dimension] * (scaledWeights[index] / scaledWeightSum);
			const next = sum + term;
			if (!Number.isFinite(next)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.weightedMean[${dimension}]`, "weighted centroid accumulation is outside the finite numeric range");
			correction += Math.abs(sum) >= Math.abs(term) ? sum - next + term : term - next + sum;
			if (!Number.isFinite(correction)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.weightedMean[${dimension}]`, "weighted centroid correction is outside the finite numeric range");
			sum = next;
		});
		const result = sum + correction;
		if (!Number.isFinite(result)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.weightedMean[${dimension}]`, "weighted centroid is outside the finite numeric range");
		return result;
	});
	const weightSum = maximumWeight * scaledWeightSum;
	const effectiveParticipantN = scaledWeightSum * scaledWeightSum / squaredScaledWeightSum;
	if (!Number.isFinite(effectiveParticipantN)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.effectiveParticipantN", "effective sample size is outside the finite numeric range");
	return {
		centroid,
		weightSum: Number.isFinite(weightSum) ? weightSum : null,
		effectiveParticipantN
	};
}
function subtract$1(right, left) {
	return right.map((value, dimension) => {
		const output = value - left[dimension];
		if (!Number.isFinite(output)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.delta[${dimension}]`, "coordinate delta is outside the finite numeric range");
		return output;
	});
}
function distance(delta) {
	const output = Math.hypot(...delta);
	if (!Number.isFinite(output)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.distance", "Euclidean distance is outside the finite numeric range");
	return output;
}
function pathMetrics(centroids, dimensions, elapsedFromPrevious) {
	let continuous = true;
	let cumulative = 0;
	return centroids.map((centroid, index) => {
		if (centroid === null) {
			continuous = false;
			return {
				dimensions: [...dimensions],
				delta: null,
				stepDistance: null,
				cumulativeDistance: null,
				speed: null
			};
		}
		if (index === 0) return {
			dimensions: [...dimensions],
			delta: null,
			stepDistance: 0,
			cumulativeDistance: 0,
			speed: null
		};
		const previous = centroids[index - 1];
		if (previous === null || previous === void 0) {
			continuous = false;
			return {
				dimensions: [...dimensions],
				delta: null,
				stepDistance: null,
				cumulativeDistance: null,
				speed: null
			};
		}
		const delta = subtract$1(centroid, previous);
		const stepDistance = distance(delta);
		const speed = stepDistance / elapsedFromPrevious[index];
		if (!Number.isFinite(speed)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.periods[${index}].speed`, "speed is outside the finite numeric range");
		if (continuous) {
			cumulative += stepDistance;
			if (!Number.isFinite(cumulative)) rejectTrajectoryDynamics("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.periods[${index}].cumulativeDistance`, "cumulative distance is outside the finite numeric range");
		}
		return {
			dimensions: [...dimensions],
			delta,
			stepDistance,
			cumulativeDistance: continuous ? cumulative : null,
			speed
		};
	});
}
function diagnosticSummary(diagnostics) {
	return {
		info: diagnostics.filter(({ severity }) => severity === "info").length,
		warning: diagnostics.filter(({ severity }) => severity === "warning").length,
		codes: [...new Set(diagnostics.map(({ code }) => code))]
	};
}
function buildDiagnostics(series, participantPeriods, periods, duplicateRows, cohortExcludedParticipants, timeVaryingWeights) {
	const diagnostics = [{
		code: "TIME_SEMANTICS_RESOLVED",
		severity: "info",
		message: `Elapsed time uses ${series.timeContract.kind} with unit ${series.timeContract.elapsedUnit}.`
	}, {
		code: series.input.estimand.kind === "equal-participant-v1" ? "EQUAL_PARTICIPANT_ESTIMAND" : "WEIGHTED_PARTICIPANT_ESTIMAND",
		severity: "info",
		message: series.input.estimand.kind === "equal-participant-v1" ? "Each included participant-period contributes equal centroid weight after duplicate reduction." : "Each included participant-period contributes its explicit positive weight after duplicate reduction."
	}];
	if (duplicateRows > 0) diagnostics.push({
		code: "DUPLICATE_PARTICIPANT_PERIOD_ROWS",
		severity: "warning",
		message: `${duplicateRows} duplicate source rows were reduced before centroid estimation.`,
		count: duplicateRows
	});
	const providedWeights = series.points.filter(({ weight }) => weight !== void 0).length;
	if (series.input.estimand.kind === "equal-participant-v1" && providedWeights > 0) diagnostics.push({
		code: "PARTICIPANT_WEIGHTS_IGNORED",
		severity: "warning",
		message: `${providedWeights} source rows provided weights that equal-participant-v1 intentionally ignored.`,
		count: providedWeights
	});
	if (cohortExcludedParticipants > 0) diagnostics.push({
		code: "INCOMPLETE_PARTICIPANTS_EXCLUDED",
		severity: "warning",
		message: `${cohortExcludedParticipants} participants were excluded from every period by complete cohort policy.`,
		count: cohortExcludedParticipants
	});
	if (timeVaryingWeights > 0) diagnostics.push({
		code: "TIME_VARYING_PARTICIPANT_WEIGHT",
		severity: "warning",
		message: `${timeVaryingWeights} participants use different weights across periods; the weighted estimand is period-specific.`,
		count: timeVaryingWeights
	});
	for (const period of periods) {
		if (period.nParticipantPeriods === 0) diagnostics.push({
			code: "MISSING_TRAJECTORY_PERIOD",
			severity: "warning",
			message: "No participant-period was observed for this expected period; centroids and path metrics are withheld.",
			path: `periods[${period.index}]`
		});
		else if (period.nUsed === 0) diagnostics.push({
			code: "EMPTY_TRAJECTORY_PERIOD_AFTER_COHORT",
			severity: "warning",
			message: "Participant-period rows exist, but cohort policy excludes all of them from this centroid.",
			path: `periods[${period.index}]`
		});
		else if (period.nUsed === 1) diagnostics.push({
			code: "SINGLE_PARTICIPANT_PERIOD",
			severity: "warning",
			message: "This centroid is determined by one participant-period.",
			path: `periods[${period.index}]`
		});
		if (period.weightSum === null && period.nUsed > 0) diagnostics.push({
			code: "UNREPRESENTABLE_WEIGHT_SUM",
			severity: "warning",
			message: "The weighted centroid is finite, but the unscaled sum of weights exceeds the finite numeric range.",
			path: `periods[${period.index}].weightSum`
		});
		if (period.effectiveParticipantN !== null && period.effectiveParticipantN < 2 && period.nUsed > 1) diagnostics.push({
			code: "LOW_EFFECTIVE_PARTICIPANT_N",
			severity: "warning",
			message: "Weight concentration reduces the effective participant count below two.",
			path: `periods[${period.index}].effectiveParticipantN`
		});
	}
	if (periods.some(({ nUsed }, index) => nUsed === 0 && periods.slice(index + 1).some((later) => later.nUsed > 0))) diagnostics.push({
		code: "TRAJECTORY_GAP_BREAKS_PATH",
		severity: "warning",
		message: "Expected periods without a centroid are not bridged; downstream cumulative distance remains unavailable."
	});
	if (series.input.cohortPolicy === "available") {
		const participantsByTime = /* @__PURE__ */ new Map();
		for (const participantPeriod of participantPeriods) {
			if (!participantPeriod.includedInCohort) continue;
			const participants = participantsByTime.get(participantPeriod.time.canonical) ?? [];
			participants.push(participantPeriod.participant.canonical);
			participantsByTime.set(participantPeriod.time.canonical, participants);
		}
		const signatures = periods.map((period) => (participantsByTime.get(period.time.canonical) ?? []).sort(compareCanonical$1).join("\0"));
		if (new Set(signatures).size > 1) diagnostics.push({
			code: "CHANGING_AVAILABLE_COHORT",
			severity: "warning",
			message: "Participant composition changes across requested periods."
		});
	}
	return diagnostics;
}
function analyzeTrajectoryDynamicsV1(input) {
	const series = normalizeInput(input);
	const reduction = reduceParticipantPeriods$1(series);
	const weighted = series.input.estimand.kind === "weighted-participant-v1";
	const rawCountByTime = /* @__PURE__ */ new Map();
	for (const point of series.points) rawCountByTime.set(point.time.canonical, (rawCountByTime.get(point.time.canonical) ?? 0) + 1);
	const participantPeriodsByTime = /* @__PURE__ */ new Map();
	for (const participantPeriod of reduction.participantPeriods) {
		const entries = participantPeriodsByTime.get(participantPeriod.time.canonical) ?? [];
		entries.push(participantPeriod);
		participantPeriodsByTime.set(participantPeriod.time.canonical, entries);
	}
	const periodRows = series.periods.map(({ key }, index) => {
		const nRows = rawCountByTime.get(key.canonical) ?? 0;
		const all = participantPeriodsByTime.get(key.canonical) ?? [];
		const used = all.filter(({ includedInCohort }) => includedInCohort);
		return {
			index,
			nRows,
			all,
			used,
			centroid: finiteWeightedCentroid(used, series.dimensions.length, weighted)
		};
	});
	const fullCentroids = periodRows.map(({ centroid }) => centroid.centroid);
	const selectedCentroids = fullCentroids.map((centroid) => centroid === null ? null : series.selectedIndexes.map((selected) => centroid[selected]));
	const selectedMetrics = pathMetrics(selectedCentroids, series.selectedDimensions, series.elapsedFromPrevious);
	const fullMetrics = pathMetrics(fullCentroids, series.dimensions, series.elapsedFromPrevious);
	const periods = periodRows.map(({ index, nRows, all, used, centroid }) => ({
		index,
		time: series.periods[index].key,
		timeValue: cloneTimeValue(series.periods[index].definition.value),
		elapsedFromPrevious: series.elapsedFromPrevious[index],
		elapsedFromStart: series.elapsedFromStart[index],
		selectedCentroid: selectedCentroids[index],
		fullCentroid: centroid.centroid,
		selected3d: selectedMetrics[index],
		fullSpace: fullMetrics[index],
		nRows,
		nParticipantPeriods: all.length,
		nUsed: used.length,
		nDuplicateRows: nRows - all.length,
		nCohortExcluded: all.length - used.length,
		weightSum: centroid.weightSum,
		effectiveParticipantN: centroid.effectiveParticipantN
	}));
	const diagnostics = buildDiagnostics(series, reduction.participantPeriods, periods, reduction.duplicateRows, reduction.cohortExcludedParticipants, reduction.timeVaryingWeights);
	return deepFreeze$3({
		schemaVersion: "3dena.trajectory-dynamics.v1",
		namespace: series.namespace,
		cohortPolicy: series.input.cohortPolicy,
		estimand: { ...series.input.estimand },
		dimensions: [...series.dimensions],
		selectedDimensions: [...series.selectedDimensions],
		timeContract: { ...series.timeContract },
		contracts: {
			duplicateReduction: "equal-row-coordinate-mean-before-centroid-v1",
			weightResolution: "constant-within-participant-period-v1",
			cohort: "available-or-complete-before-centroid-v1",
			distance: "euclidean-selected-and-full-space-v1",
			gap: "expected-period-no-bridge-v1",
			speed: "step-distance-divided-by-positive-adjacent-elapsed-v1"
		},
		participantPeriods: reduction.participantPeriods,
		periods,
		diagnostics,
		diagnosticSummary: diagnosticSummary(diagnostics),
		summary: {
			inputRows: series.points.length,
			participants: new Set(series.points.map(({ participant }) => participant.canonical)).size,
			participantPeriods: reduction.participantPeriods.length,
			periods: series.periods.length,
			observedPeriods: periods.filter(({ nParticipantPeriods }) => nParticipantPeriods > 0).length,
			missingPeriods: periods.filter(({ nParticipantPeriods }) => nParticipantPeriods === 0).length,
			duplicateRows: reduction.duplicateRows,
			cohortExcludedParticipants: reduction.cohortExcludedParticipants
		},
		evidence: {
			status: "IMPLEMENTED_UNVERIFIED",
			oracleParityClaim: false,
			scientificAuthority: "successor-definition-pending-review"
		},
		resolvedLimits: { ...series.limits }
	});
}
function deepFreeze$3(value) {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze$3(nested);
		Object.freeze(value);
	}
	return value;
}
//#endregion
//#region packages/trajectory/src/analyze-v2.ts
function finiteDoubleBits(value) {
	const view = /* @__PURE__ */ new DataView(/* @__PURE__ */ new ArrayBuffer(8));
	view.setFloat64(0, value, false);
	return view.getBigUint64(0, false).toString(16).padStart(16, "0");
}
function identityToken(component, path) {
	if (!component || typeof component !== "object" || typeof component.name !== "string" || component.name.trim() === "") rejectTrajectoryDynamics("INVALID_IDENTITY_COMPONENT", path, "must have a non-empty component name");
	if (component.type === "string" && typeof component.value === "string" && component.value !== "") return [
		component.name,
		"string",
		component.declaredType ?? "string",
		component.value
	];
	if (component.type === "boolean" && typeof component.value === "boolean") return [
		component.name,
		"boolean",
		component.declaredType ?? "boolean",
		component.value ? "true" : "false"
	];
	if (component.type === "number" && typeof component.value === "number" && Number.isFinite(component.value)) {
		if (Number.isInteger(component.value) && !Number.isSafeInteger(component.value)) rejectTrajectoryDynamics("UNSAFE_INTEGER_IDENTITY", `${path}.value`, "unsafe integer identities must be lossless strings");
		return [
			component.name,
			"number",
			component.declaredType ?? "double",
			finiteDoubleBits(component.value)
		];
	}
	rejectTrajectoryDynamics("INVALID_IDENTITY_VALUE", `${path}.value`, "declared identity type must match its finite value");
}
function normalizeIdentity$1(identity, path) {
	if (!identity || !Array.isArray(identity.components) || identity.components.length === 0) rejectTrajectoryDynamics("INVALID_TRAJECTORY_IDENTITY", path, "must contain at least one typed component");
	const names = /* @__PURE__ */ new Set();
	const entries = identity.components.map((component, index) => {
		const token = identityToken(component, `${path}.components[${index}]`);
		if (names.has(component.name)) rejectTrajectoryDynamics("DUPLICATE_IDENTITY_COMPONENT", `${path}.components[${index}].name`, "duplicates an earlier component name");
		names.add(component.name);
		return {
			component: { ...component },
			token
		};
	});
	return {
		components: entries.map(({ component }) => component),
		canonical: JSON.stringify(entries.map(({ token }) => token)),
		display: entries.map(({ component }) => String(component.value)).join(" · ")
	};
}
function deepFreeze$2(value) {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze$2(child);
		Object.freeze(value);
	}
	return value;
}
/** Executes every valid group against one shared dimension, period and cohort contract. */
function analyzeTrajectoryPathSetV2(input) {
	if (!input || typeof input !== "object" || input.schemaVersion !== "3dena.trajectory-path-set-input.v2") rejectTrajectoryDynamics("UNKNOWN_TRAJECTORY_PATH_SET_VERSION", "input.schemaVersion", "must be 3dena.trajectory-path-set-input.v2");
	if (!Array.isArray(input.groups) || input.groups.length === 0) rejectTrajectoryDynamics("EMPTY_TRAJECTORY_GROUPS", "input.groups", "must contain at least one group");
	const seen = /* @__PURE__ */ new Set();
	const groups = input.groups.map((group, index) => {
		if (!group || typeof group !== "object") rejectTrajectoryDynamics("INVALID_TRAJECTORY_GROUP", `input.groups[${index}]`, "must be an object");
		const key = normalizeIdentity$1(group.group, `input.groups[${index}].group`);
		if (seen.has(key.canonical)) rejectTrajectoryDynamics("DUPLICATE_TRAJECTORY_GROUP", `input.groups[${index}].group`, "duplicates an earlier typed group identity");
		seen.add(key.canonical);
		return {
			group: key,
			dynamics: analyzeTrajectoryDynamicsV1({
				schemaVersion: "3dena.trajectory-dynamics-input.v1",
				namespace: group.namespace,
				dimensions: [...input.dimensions],
				selectedDimensions: [...input.selectedDimensions],
				periods: input.periods.map((period) => ({
					time: { components: period.time.components.map((component) => ({ ...component })) },
					value: { ...period.value }
				})),
				cohortPolicy: input.cohortPolicy,
				estimand: { ...input.estimand },
				points: group.points.map((point) => ({
					participant: { components: point.participant.components.map((component) => ({ ...component })) },
					time: { components: point.time.components.map((component) => ({ ...component })) },
					coordinates: [...point.coordinates],
					...point.weight === void 0 ? {} : { weight: point.weight }
				})),
				...input.limits ? { limits: { ...input.limits } } : {}
			})
		};
	});
	return deepFreeze$2({
		schemaVersion: "3dena.trajectory-path-set.v2",
		dimensions: [...input.dimensions],
		selectedDimensions: [...input.selectedDimensions],
		cohortPolicy: input.cohortPolicy,
		estimand: { ...input.estimand },
		groups,
		summary: {
			groups: groups.length,
			participants: groups.reduce((sum, group) => sum + group.dynamics.summary.participants, 0),
			participantPeriods: groups.reduce((sum, group) => sum + group.dynamics.summary.participantPeriods, 0),
			duplicateRows: groups.reduce((sum, group) => sum + group.dynamics.summary.duplicateRows, 0),
			missingGroupPeriods: groups.reduce((sum, group) => sum + group.dynamics.summary.missingPeriods, 0)
		},
		evidence: {
			status: "IMPLEMENTED_UNVERIFIED",
			scientificAuthority: "jena-js-and-versioned-3dena-contract",
			rEnaOracle: false
		}
	});
}
//#endregion
//#region packages/analysis/src/network-analysis.ts
var NetworkAnalysisError = class extends Error {
	code;
	path;
	constructor(code, path, message) {
		super(`${path}: ${message}`);
		this.name = "NetworkAnalysisError";
		this.code = code;
		this.path = path;
	}
};
function reject$4(code, path, message) {
	throw new NetworkAnalysisError(code, path, message);
}
function rawScalarCanonical(value) {
	if (value === null) return JSON.stringify(["null"]);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) reject$4("NON_FINITE_LEVEL", "selector.level", "must be finite");
		if (Number.isInteger(value) && !Number.isSafeInteger(value)) reject$4("UNSAFE_INTEGER_LEVEL", "selector.level", "unsafe integer identities must be supplied as source strings");
		if (Object.is(value, -0)) return JSON.stringify(["number", "-0"]);
	}
	return JSON.stringify([typeof value, value]);
}
function validateSource(result) {
	if (!result || result.schemaVersion !== "3dena.analysis-result.v1") reject$4("INVALID_SOURCE_RESULT", "result", "must be a validated raw analysis result");
	if (result.edges.length === 0) reject$4("EMPTY_EDGE_SET", "result.edges", "must contain at least one edge");
	if (result.points.length === 0) reject$4("EMPTY_POINT_SET", "result.points", "must contain at least one point");
	if (result.dimensions.length === 0) reject$4("EMPTY_DIMENSION_SET", "result.dimensions", "must contain at least one dimension");
	for (const point of result.points) {
		if (point.lineWeights.length !== result.edges.length) reject$4("MISALIGNED_LINE_WEIGHTS", `result.points[${point.index}].lineWeights`, "must align one-to-one with result.edges");
		if (point.fullCoordinates.length !== result.dimensions.length) reject$4("MISALIGNED_COORDINATES", `result.points[${point.index}].fullCoordinates`, "must align one-to-one with result.dimensions");
	}
}
function mean$1(values, path) {
	if (values.length === 0) reject$4("EMPTY_NETWORK_SELECTION", path, "contains no analysis points");
	let sum = 0;
	let correction = 0;
	for (const value of values) {
		if (!Number.isFinite(value)) reject$4("NON_FINITE_SOURCE_VALUE", path, "contains a non-finite model value");
		const adjusted = value - correction;
		const next = sum + adjusted;
		correction = next - sum - adjusted;
		sum = next;
	}
	return sum / values.length;
}
function edgeMean(edge, points) {
	return {
		index: edge.index,
		id: edge.id,
		column: edge.column,
		source: edge.source,
		target: edge.target,
		meanWeight: mean$1(points.map((point) => point.lineWeights[edge.index]), `edges[${edge.index}]`)
	};
}
function networkMean(result, points) {
	if (points.length === 0) reject$4("EMPTY_NETWORK_SELECTION", "selection", "contains no analysis points");
	return {
		pointCount: points.length,
		pointIndexes: points.map((point) => point.index),
		meanCoordinates: result.dimensions.map((_, dimensionIndex) => mean$1(points.map((point) => point.fullCoordinates[dimensionIndex]), `dimensions[${dimensionIndex}]`)),
		edges: result.edges.map((edge) => edgeMean(edge, points))
	};
}
function groupValue(result, canonical, path) {
	if (typeof canonical !== "string" || canonical.length === 0) reject$4("INVALID_GROUP", path, "must be a non-empty canonical group key");
	const group = result.trajectory?.groupOrder.find((candidate) => candidate.canonical === canonical) ?? result.points.find((point) => point.group?.canonical === canonical)?.group;
	if (!group) reject$4("UNKNOWN_GROUP", path, "is not present in the source result");
	return group;
}
/**
* Computes the formal `mean(groupA) - mean(groupB)` network over already fitted
* point line weights. It never refits jENA and preserves source edge order.
*/
function compareGroupNetworks(result, groups) {
	validateSource(result);
	if (!Array.isArray(groups) || groups.length !== 2) reject$4("INVALID_GROUP_PAIR", "groups", "must contain exactly two canonical group keys");
	if (groups[0] === groups[1]) reject$4("IDENTICAL_GROUPS", "groups", "must select two different groups");
	const groupA = groupValue(result, groups[0], "groups[0]");
	const groupB = groupValue(result, groups[1], "groups[1]");
	const meanA = networkMean(result, result.points.filter((point) => point.group?.canonical === groupA.canonical));
	const meanB = networkMean(result, result.points.filter((point) => point.group?.canonical === groupB.canonical));
	const differenceEdges = meanA.edges.map((edgeA, index) => {
		const edgeB = meanB.edges[index];
		const difference = edgeA.meanWeight - edgeB.meanWeight;
		return {
			...edgeA,
			meanWeight: difference,
			groupAMeanWeight: edgeA.meanWeight,
			groupBMeanWeight: edgeB.meanWeight,
			semanticOwner: difference > 0 ? "group-a" : difference < 0 ? "group-b" : "equal"
		};
	});
	return {
		schemaVersion: "3dena.network-comparison.v1",
		direction: "group-a-minus-group-b",
		groupA: { ...groupA },
		groupB: { ...groupB },
		meanA,
		meanB,
		differenceEdges,
		diagnostics: [{
			code: "CONFIDENCE_BOX_PENDING_AUTHORITY",
			severity: "warning",
			message: "Confidence-box inference is withheld until its scientific authority and interval contract are approved.",
			path: "confidenceBox"
		}]
	};
}
/** Selects one exact metadata/group level and computes its mean network. */
function analyzeChangeNetwork(result, selector) {
	validateSource(result);
	if (!selector || typeof selector.field !== "string" || selector.field.trim() === "") reject$4("INVALID_CHANGE_FIELD", "selector.field", "must be a non-empty metadata column name or @group");
	const levelCanonical = rawScalarCanonical(selector.level);
	const selected = result.points.filter((point) => {
		const value = selector.field === "@group" ? point.group?.value : point.metadata[selector.field];
		return value !== void 0 && rawScalarCanonical(value) === levelCanonical;
	});
	if (selected.length === 0) reject$4("UNKNOWN_CHANGE_LEVEL", "selector.level", "does not select any analysis points");
	return {
		schemaVersion: "3dena.change-network.v1",
		selector: {
			field: selector.field,
			level: selector.level
		},
		levelCanonical,
		mean: networkMean(result, selected),
		diagnostics: [{
			code: "CONFIDENCE_BOX_PENDING_AUTHORITY",
			severity: "warning",
			message: "Confidence-box inference is withheld until its scientific authority and interval contract are approved.",
			path: "confidenceBox"
		}]
	};
}
//#endregion
//#region packages/analysis/src/prepared-space.ts
init_types();
var SOURCE_ROW_OCCURRENCE = "@3dena/source-row-occurrence";
var SOURCE_NAME_MAX_UTF8_BYTES = 1024;
var IDENTITY_STRING_MAX_UTF8_BYTES = 32768;
var PREPARED_PARTICIPANT_COLUMN_LIMIT = 500;
var PREPARED_TIME_ORDER_LIMIT = 1e4;
var PREPARED_GROUP_LIMIT = 200;
var PREPARED_TRAJECTORY_CELL_LIMIT = 1e6;
var UTF8_ENCODER = new TextEncoder();
function issue(code, path, message) {
	return {
		code,
		path,
		message
	};
}
function reject$3(code, path, message) {
	throw new AnalysisValidationError([issue(code, path, message)]);
}
function columnMap(table) {
	return new Map(table.columns.map((column) => [column.name, column]));
}
function requiredColumn(columns, name, path) {
	const column = columns.get(name);
	if (!column) reject$3("MISSING_PREPARED_COLUMN", path, `column ${JSON.stringify(name)} is required`);
	return column;
}
function rawValue(column, rowIndex, path) {
	const value = column.values[rowIndex];
	if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") reject$3("INVALID_PREPARED_SCALAR", path, "must be a scalar exchange value");
	if (typeof value === "number" && !Number.isFinite(value)) reject$3("NON_FINITE_PREPARED_VALUE", path, "must be finite");
	return value ?? null;
}
function validateIdentityScalar(value, path) {
	if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") reject$3("INVALID_PREPARED_IDENTITY", path, "must be a scalar value");
	if (value === null) reject$3("MISSING_PREPARED_IDENTITY", path, "identity values must not be null");
	if (typeof value === "string" && value.trim().length === 0) reject$3("BLANK_PREPARED_IDENTITY", path, "identity strings must not be blank");
	if (typeof value === "string" && UTF8_ENCODER.encode(value).byteLength > IDENTITY_STRING_MAX_UTF8_BYTES) reject$3("PREPARED_IDENTITY_TOO_LONG", path, `must not exceed ${IDENTITY_STRING_MAX_UTF8_BYTES} UTF-8 bytes`);
	if (typeof value === "number" && !Number.isFinite(value)) reject$3("NON_FINITE_PREPARED_IDENTITY", path, "numeric identities must be finite");
	if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) reject$3("UNSAFE_PREPARED_INTEGER_IDENTITY", path, "integer identities outside the JavaScript safe range must be encoded as strings");
}
function scalarToken$1(value) {
	if (value === null) return ["null", ""];
	if (typeof value === "string") return ["string", value];
	if (typeof value === "boolean") return ["boolean", value ? "true" : "false"];
	if (Object.is(value, -0)) return ["number", "-0"];
	return ["number", String(value)];
}
function canonicalTuple(columns, columnTypes, values) {
	return JSON.stringify(values.map((value, index) => [
		columns[index],
		columnTypes[index],
		...scalarToken$1(value)
	]));
}
function displayScalar(value) {
	return value === null ? "" : String(value);
}
function entityKeyFromColumns(columns, rowIndex, path) {
	const names = columns.map((column) => column.name);
	const types = columns.map((column) => column.type);
	const values = columns.map((column) => {
		const value = rawValue(column, rowIndex, `${path}.${column.name}`);
		validateIdentityScalar(value, `${path}.${column.name}`);
		return value;
	});
	return {
		canonical: canonicalTuple(names, types, values),
		display: values.map(displayScalar).join(" · "),
		columns: [...names],
		columnTypes: [...types],
		values
	};
}
function appendOccurrence(key, occurrence) {
	const columns = [...key.columns, SOURCE_ROW_OCCURRENCE];
	const columnTypes = [...key.columnTypes, "integer"];
	const values = [...key.values, occurrence];
	return {
		canonical: canonicalTuple(columns, columnTypes, values),
		display: `${key.display} · ${occurrence}`,
		columns,
		columnTypes,
		values
	};
}
function typedValueFromColumn(column, rowIndex, path) {
	const value = rawValue(column, rowIndex, path);
	validateIdentityScalar(value, path);
	return typedValue(column.name, column.type, value);
}
function typedValue(column, columnType, value) {
	validateIdentityScalar(value, `mapping.timeOrder[${displayScalar(value)}]`);
	return {
		canonical: canonicalTuple([column], [columnType], [value]),
		display: displayScalar(value),
		column,
		columnType,
		value
	};
}
function sameTypedValue(left, right) {
	return left.canonical === right.canonical;
}
function numericColumnValue(column, rowIndex, path) {
	const value = rawValue(column, rowIndex, path);
	if (typeof value !== "number" || !Number.isFinite(value)) reject$3("INVALID_PREPARED_COORDINATE", path, "prepared coordinates and weights must be present finite numbers");
	return value;
}
function validateSourceName(name) {
	if (typeof name !== "string" || name.trim().length === 0) reject$3("INVALID_PREPARED_SOURCE_NAME", "source.name", "must be a non-blank string");
	if (/[\u0000-\u001f\u007f-\u009f]/u.test(name)) reject$3("INVALID_PREPARED_SOURCE_NAME", "source.name", "must not contain control characters");
	if (/[\\/]/u.test(name)) reject$3("INVALID_PREPARED_SOURCE_NAME", "source.name", "must be a file name, not a path");
	if (UTF8_ENCODER.encode(name).byteLength > SOURCE_NAME_MAX_UTF8_BYTES) reject$3("PREPARED_SOURCE_NAME_TOO_LONG", "source.name", `must not exceed ${SOURCE_NAME_MAX_UTF8_BYTES} UTF-8 bytes`);
}
function validateMapping(exchange, mapping) {
	if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) reject$3("INVALID_PREPARED_MAPPING", "mapping", "must be an object");
	if (!Array.isArray(mapping.participant) || mapping.participant.length === 0) reject$3("INVALID_PREPARED_MAPPING", "mapping.participant", "must name at least one column");
	if (mapping.participant.length > PREPARED_PARTICIPANT_COLUMN_LIMIT) reject$3("PREPARED_MAPPING_LIMIT_EXCEEDED", "mapping.participant", `must not exceed ${PREPARED_PARTICIPANT_COLUMN_LIMIT} columns`);
	if (mapping.participant.some((name) => typeof name !== "string" || name.trim().length === 0)) reject$3("INVALID_PREPARED_MAPPING", "mapping.participant", "must contain non-blank column names");
	if (new Set(mapping.participant).size !== mapping.participant.length) reject$3("DUPLICATE_PREPARED_MAPPING", "mapping.participant", "must not contain duplicate columns");
	if (!mapping.participant.includes(mapping.group)) reject$3("GROUP_OUTSIDE_PREPARED_PARTICIPANT", "mapping.group", "the trajectory group must be part of the complete participant identity");
	if (!Array.isArray(mapping.displayDimensions) || mapping.displayDimensions.length !== 3) reject$3("INVALID_PREPARED_MAPPING", "mapping.displayDimensions", "must select exactly three dimensions");
	if (mapping.displayDimensions.some((name) => typeof name !== "string" || name.trim().length === 0)) reject$3("INVALID_PREPARED_MAPPING", "mapping.displayDimensions", "must contain dimension names");
	for (const [path, value] of [
		["mapping.participantLabel", mapping.participantLabel],
		["mapping.group", mapping.group],
		["mapping.time", mapping.time]
	]) if (typeof value !== "string" || value.trim().length === 0) reject$3("INVALID_PREPARED_MAPPING", path, "must name a non-blank metadata column");
	if (new Set(mapping.displayDimensions).size !== 3) reject$3("DUPLICATE_PREPARED_MAPPING", "mapping.displayDimensions", "must contain three distinct dimensions");
	if (mapping.missingDisplayCoordinates !== void 0 && mapping.missingDisplayCoordinates !== "reject") reject$3("INVALID_PREPARED_MAPPING", "mapping.missingDisplayCoordinates", "only the reject policy is supported");
	if (mapping.cohortPolicy !== "available" && mapping.cohortPolicy !== "complete") reject$3("INVALID_PREPARED_MAPPING", "mapping.cohortPolicy", "must be available or complete");
	const metadataColumns = columnMap(exchange.tables.meta_data);
	const participantColumns = mapping.participant.map((name, index) => requiredColumn(metadataColumns, name, `mapping.participant[${index}]`));
	const participantLabelColumn = requiredColumn(metadataColumns, mapping.participantLabel, "mapping.participantLabel");
	const groupColumn = requiredColumn(metadataColumns, mapping.group, "mapping.group");
	const timeColumn = requiredColumn(metadataColumns, mapping.time, "mapping.time");
	if (!Array.isArray(mapping.timeOrder) || mapping.timeOrder.length === 0) reject$3("INVALID_PREPARED_TIME_ORDER", "mapping.timeOrder", "must contain at least one expected period");
	if (mapping.timeOrder.length > PREPARED_TIME_ORDER_LIMIT) reject$3("PREPARED_TIME_ORDER_LIMIT_EXCEEDED", "mapping.timeOrder", `must not exceed ${PREPARED_TIME_ORDER_LIMIT} expected periods`);
	const timeOrder = mapping.timeOrder.map((value, index) => {
		validateIdentityScalar(value, `mapping.timeOrder[${index}]`);
		return typedValue(timeColumn.name, timeColumn.type, value);
	});
	if (new Set(timeOrder.map((time) => time.canonical)).size !== timeOrder.length) reject$3("DUPLICATE_PREPARED_TIME", "mapping.timeOrder", "must not contain duplicate typed periods");
	return {
		metadataColumns,
		participantColumns,
		participantLabelColumn,
		groupColumn,
		timeColumn,
		timeOrder,
		displayDimensionIndexes: mapping.displayDimensions.map((dimension, index) => {
			const dimensionIndex = exchange.dimensions.indexOf(dimension);
			if (dimensionIndex < 0) reject$3("MISSING_PREPARED_DIMENSION", `mapping.displayDimensions[${index}]`, `dimension ${JSON.stringify(dimension)} is not present`);
			return dimensionIndex;
		})
	};
}
function metadataRecord(columns, rowIndex) {
	return Object.fromEntries(columns.map((column) => [column.name, rawValue(column, rowIndex, `tables.meta_data.${column.name}[${rowIndex}]`)]));
}
function buildRowKeys(sourceIdColumn, rowCount) {
	const base = Array.from({ length: rowCount }, (_, rowIndex) => entityKeyFromColumns([sourceIdColumn], rowIndex, `tables.meta_data.${sourceIdColumn.name}[${rowIndex}]`));
	const totals = /* @__PURE__ */ new Map();
	for (const key of base) totals.set(key.canonical, (totals.get(key.canonical) ?? 0) + 1);
	const occurrences = /* @__PURE__ */ new Map();
	return base.map((key) => {
		if ((totals.get(key.canonical) ?? 0) === 1) return key;
		const occurrence = (occurrences.get(key.canonical) ?? 0) + 1;
		occurrences.set(key.canonical, occurrence);
		return appendOccurrence(key, occurrence);
	});
}
function stableMean(values, path) {
	if (values.length === 0) reject$3("EMPTY_PREPARED_REDUCTION", path, "cannot reduce an empty numeric set");
	let result = 0;
	for (let index = 0; index < values.length; index += 1) {
		const count = index + 1;
		result += values[index] / count - result / count;
		if (!Number.isFinite(result)) reject$3("NON_FINITE_PREPARED_REDUCTION", path, "finite inputs produced a non-finite reduction");
	}
	return result;
}
function buildParticipantPeriods(points, timeOrder, cohortPolicy) {
	const expectedTimes = new Set(timeOrder.map((time) => time.canonical));
	const byParticipantPeriod = /* @__PURE__ */ new Map();
	const participantAttributes = /* @__PURE__ */ new Map();
	for (const point of points) {
		if (!expectedTimes.has(point.time.canonical)) reject$3("UNDECLARED_PREPARED_TIME", `tables.meta_data.${point.time.column}[${point.index}]`, `observed period ${JSON.stringify(point.time.display)} is absent from mapping.timeOrder`);
		const knownAttributes = participantAttributes.get(point.participant.canonical);
		if (!knownAttributes) participantAttributes.set(point.participant.canonical, {
			group: point.group,
			participantLabel: point.participantLabel
		});
		else {
			if (!sameTypedValue(knownAttributes.group, point.group)) reject$3("UNSTABLE_PREPARED_GROUP", `tables.meta_data.${point.group.column}[${point.index}]`, "one participant cannot change groups across periods");
			if (!sameTypedValue(knownAttributes.participantLabel, point.participantLabel)) reject$3("UNSTABLE_PREPARED_PARTICIPANT_LABEL", `tables.meta_data.${point.participantLabel.column}[${point.index}]`, "one participant cannot change display labels across periods");
		}
		const key = JSON.stringify([point.participant.canonical, point.time.canonical]);
		const existing = byParticipantPeriod.get(key);
		const displayCoordinates = point.coordinates.slice(0, 3);
		if (!existing) {
			byParticipantPeriod.set(key, {
				participant: point.participant,
				participantLabel: point.participantLabel,
				group: point.group,
				time: point.time,
				coordinateMeans: [...displayCoordinates],
				count: 1,
				sourcePointIndexes: [point.index]
			});
			continue;
		}
		if (!sameTypedValue(existing.group, point.group)) reject$3("UNSTABLE_PREPARED_GROUP", `tables.meta_data.${point.group.column}[${point.index}]`, "one participant-period cannot belong to multiple groups");
		if (!sameTypedValue(existing.participantLabel, point.participantLabel)) reject$3("UNSTABLE_PREPARED_PARTICIPANT_LABEL", `tables.meta_data.${point.participantLabel.column}[${point.index}]`, "one participant cannot have conflicting labels within a period");
		const count = existing.count + 1;
		existing.coordinateMeans = existing.coordinateMeans.map((current, axis) => current + (displayCoordinates[axis] / count - current / count));
		if (existing.coordinateMeans.some((coordinate) => !Number.isFinite(coordinate))) reject$3("NON_FINITE_PREPARED_REDUCTION", `tables.points[${point.index}]`, "finite participant-period coordinates produced a non-finite mean");
		existing.count = count;
		existing.sourcePointIndexes.push(point.index);
	}
	const periodsByParticipant = /* @__PURE__ */ new Map();
	for (const entry of byParticipantPeriod.values()) {
		const periods = periodsByParticipant.get(entry.participant.canonical) ?? /* @__PURE__ */ new Set();
		periods.add(entry.time.canonical);
		periodsByParticipant.set(entry.participant.canonical, periods);
	}
	const completeParticipants = new Set([...periodsByParticipant].filter(([, periods]) => periods.size === timeOrder.length).map(([participant]) => participant));
	return [...byParticipantPeriod.values()].map((entry, index) => ({
		index,
		participant: entry.participant,
		participantLabel: entry.participantLabel,
		group: entry.group,
		time: entry.time,
		coordinates: [...entry.coordinateMeans],
		sourcePointIndexes: [...entry.sourcePointIndexes],
		includedInCohort: cohortPolicy === "available" || completeParticipants.has(entry.participant.canonical)
	}));
}
function buildTrajectories(participantPeriods, timeOrder) {
	const groupOrder = [];
	const seenGroups = /* @__PURE__ */ new Set();
	for (const point of participantPeriods) if (!seenGroups.has(point.group.canonical)) {
		seenGroups.add(point.group.canonical);
		groupOrder.push(point.group);
	}
	const centroids = [];
	const centroidIndex = /* @__PURE__ */ new Map();
	const membersByGroupTime = /* @__PURE__ */ new Map();
	for (const point of participantPeriods) {
		if (!point.includedInCohort) continue;
		const key = JSON.stringify([point.group.canonical, point.time.canonical]);
		const members = membersByGroupTime.get(key) ?? [];
		members.push(point);
		membersByGroupTime.set(key, members);
	}
	for (const group of groupOrder) for (const time of timeOrder) {
		const key = JSON.stringify([group.canonical, time.canonical]);
		const members = membersByGroupTime.get(key) ?? [];
		if (members.length === 0) continue;
		const coordinates = [
			stableMean(members.map((point) => point.coordinates[0]), `trajectory.${group.display}.${time.display}.SVD1`),
			stableMean(members.map((point) => point.coordinates[1]), `trajectory.${group.display}.${time.display}.SVD2`),
			stableMean(members.map((point) => point.coordinates[2]), `trajectory.${group.display}.${time.display}.SVD3`)
		];
		const index = centroids.length;
		centroids.push({
			index,
			group,
			time,
			coordinates,
			participantCount: members.length,
			participantPeriodIndexes: members.map((point) => point.index)
		});
		centroidIndex.set(key, index);
	}
	return {
		groupOrder,
		centroids,
		paths: groupOrder.map((group) => ({
			group,
			steps: timeOrder.map((time) => ({
				time,
				centroidIndex: centroidIndex.get(JSON.stringify([group.canonical, time.canonical])) ?? null
			}))
		}))
	};
}
/**
* Reduces a validated, precomputed ENA exchange without invoking jENA or
* fitting a new rotation. Full source coordinates and line weights are
* preserved; only participant-period and group-time summaries are computed.
*/
function analyzePreparedSpace(input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) reject$3("INVALID_PREPARED_INPUT", "input", "must be an object");
	if (!input.source || typeof input.source !== "object") reject$3("INVALID_PREPARED_SOURCE", "source", "must contain a validated hashed artifact");
	validateSourceName(input.source.name);
	const artifact = input.source.artifact;
	if (!isHashedEna3dExchangeV1(artifact) || !/^[a-f0-9]{64}$/u.test(artifact.sha256) || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 1 || !artifact.exchange || typeof artifact.exchange !== "object") reject$3("INVALID_PREPARED_RECEIPT", "source.artifact", "must be a validated exchange with lowercase SHA-256 and positive byte length");
	const exchange = artifact.exchange;
	const resolved = validateMapping(exchange, input.mapping);
	const metadataRows = exchange.tables.meta_data.columns[0]?.values.length ?? 0;
	if (metadataRows < 1) reject$3("EMPTY_PREPARED_SPACE", "tables.meta_data", "must contain at least one point row");
	const metadataSourceId = requiredColumn(resolved.metadataColumns, "ENA_UNIT", "tables.meta_data.ENA_UNIT");
	const pointColumns = columnMap(exchange.tables.points);
	const lineWeightColumns = columnMap(exchange.tables.line_weights);
	const nodeColumns = columnMap(exchange.tables.nodes);
	const pointDimensionColumns = exchange.dimensions.map((dimension) => requiredColumn(pointColumns, dimension, `tables.points.${dimension}`));
	const nodeDimensionColumns = exchange.dimensions.map((dimension) => requiredColumn(nodeColumns, dimension, `tables.nodes.${dimension}`));
	const sourceRowKeys = buildRowKeys(metadataSourceId, metadataRows);
	const points = Array.from({ length: metadataRows }, (_, rowIndex) => ({
		index: rowIndex,
		id: sourceRowKeys[rowIndex],
		participant: entityKeyFromColumns(resolved.participantColumns, rowIndex, `tables.meta_data[${rowIndex}]`),
		participantLabel: typedValueFromColumn(resolved.participantLabelColumn, rowIndex, `tables.meta_data.${resolved.participantLabelColumn.name}[${rowIndex}]`),
		group: typedValueFromColumn(resolved.groupColumn, rowIndex, `tables.meta_data.${resolved.groupColumn.name}[${rowIndex}]`),
		time: typedValueFromColumn(resolved.timeColumn, rowIndex, `tables.meta_data.${resolved.timeColumn.name}[${rowIndex}]`),
		metadata: metadataRecord(exchange.tables.meta_data.columns, rowIndex),
		coordinates: pointDimensionColumns.map((column) => numericColumnValue(column, rowIndex, `tables.points.${column.name}[${rowIndex}]`))
	}));
	const codeColumn = requiredColumn(nodeColumns, "code", "tables.nodes.code");
	const nodeCount = codeColumn.values.length;
	const nodes = Array.from({ length: nodeCount }, (_, rowIndex) => {
		const code = rawValue(codeColumn, rowIndex, `tables.nodes.code[${rowIndex}]`);
		validateIdentityScalar(code, `tables.nodes.code[${rowIndex}]`);
		if (typeof code !== "string") reject$3("INVALID_PREPARED_NODE_CODE", `tables.nodes.code[${rowIndex}]`, "must be a string");
		return {
			index: rowIndex,
			code,
			coordinates: nodeDimensionColumns.map((column) => numericColumnValue(column, rowIndex, `tables.nodes.${column.name}[${rowIndex}]`))
		};
	});
	const nodeIndexByCode = new Map(nodes.map((node) => [node.code, node.index]));
	const edgeColumns = exchange.tables.adjacency_key.columns;
	const lineWeightValues = edgeColumns.map((edgeColumn) => {
		const weightColumn = requiredColumn(lineWeightColumns, edgeColumn.name, `tables.line_weights.${edgeColumn.name}`);
		return Array.from({ length: metadataRows }, (_, rowIndex) => numericColumnValue(weightColumn, rowIndex, `tables.line_weights.${edgeColumn.name}[${rowIndex}]`));
	});
	const edges = edgeColumns.map((edgeColumn, index) => {
		const sourceValue = rawValue(edgeColumn, 0, `tables.adjacency_key.${edgeColumn.name}[0]`);
		const targetValue = rawValue(edgeColumn, 1, `tables.adjacency_key.${edgeColumn.name}[1]`);
		if (typeof sourceValue !== "string" || typeof targetValue !== "string") reject$3("INVALID_PREPARED_EDGE", `tables.adjacency_key.${edgeColumn.name}`, "edge endpoints must be string node codes");
		const sourceIndex = nodeIndexByCode.get(sourceValue);
		const targetIndex = nodeIndexByCode.get(targetValue);
		if (sourceIndex === void 0 || targetIndex === void 0) reject$3("INVALID_PREPARED_EDGE", `tables.adjacency_key.${edgeColumn.name}`, "edge endpoints must reference existing nodes");
		return {
			index,
			id: canonicalTuple(["source", "target"], ["character", "character"], [sourceValue, targetValue]),
			column: edgeColumn.name,
			source: sourceValue,
			target: targetValue,
			sourceIndex,
			targetIndex,
			meanWeight: stableMean(lineWeightValues[index], `tables.line_weights.${edgeColumn.name}`)
		};
	});
	const displayPoints = points.map((point) => ({
		pointIndex: point.index,
		id: point.id,
		group: point.group,
		time: point.time,
		coordinates: resolved.displayDimensionIndexes.map((dimensionIndex) => point.coordinates[dimensionIndex])
	}));
	const displayNodes = nodes.map((node) => ({
		nodeIndex: node.index,
		code: node.code,
		coordinates: resolved.displayDimensionIndexes.map((dimensionIndex) => node.coordinates[dimensionIndex])
	}));
	const participantPeriods = buildParticipantPeriods(points.map((point, index) => ({
		...point,
		coordinates: displayPoints[index].coordinates
	})), resolved.timeOrder, input.mapping.cohortPolicy);
	const observedGroupCount = new Set(participantPeriods.map((point) => point.group.canonical)).size;
	if (observedGroupCount > PREPARED_GROUP_LIMIT) reject$3("PREPARED_GROUP_LIMIT_EXCEEDED", "mapping.group", `mapped groups must not exceed ${PREPARED_GROUP_LIMIT}`);
	if (observedGroupCount * resolved.timeOrder.length > PREPARED_TRAJECTORY_CELL_LIMIT) reject$3("PREPARED_TRAJECTORY_LIMIT_EXCEEDED", "mapping.timeOrder", `group-by-time path cells must not exceed ${PREPARED_TRAJECTORY_CELL_LIMIT}`);
	const trajectory = buildTrajectories(participantPeriods, resolved.timeOrder);
	const diagnostics = [{
		code: "PRECOMPUTED_SPACE_IMPORT",
		severity: "info",
		message: "Coordinates were imported from a validated exchange; no raw accumulation, rotation, eigenvalue, or variance computation was performed."
	}, {
		code: "PRECOMPUTED_COMPATIBILITY_NOT_PARITY",
		severity: "warning",
		message: "Prepared coordinates are generic precomputed compatibility input and have no raw-recomputation or parity approval claim."
	}];
	return {
		schemaVersion: "3dena.prepared-space-result.v1",
		sourceKind: "prepared-exchange",
		rawJenaRecompute: false,
		sourceReceipt: {
			name: input.source.name,
			sha256: artifact.sha256,
			byteLength: artifact.byteLength
		},
		artifacts: {
			rotation: "not-present",
			eigenvalues: "not-present",
			variance: "not-present"
		},
		fullSpace: {
			dimensions: [...exchange.dimensions],
			points,
			nodes,
			edges,
			lineWeights: {
				rowKeys: sourceRowKeys,
				columns: edgeColumns.map((column) => column.name),
				values: Array.from({ length: metadataRows }, (_, rowIndex) => lineWeightValues.map((column) => column[rowIndex]))
			}
		},
		displaySpace: {
			dimensions: [...input.mapping.displayDimensions],
			points: displayPoints,
			nodes: displayNodes,
			trajectory: {
				space: "prepared-exchange-display-space",
				dimensions: [...input.mapping.displayDimensions],
				cohortPolicy: input.mapping.cohortPolicy,
				groupOrder: trajectory.groupOrder,
				timeOrder: resolved.timeOrder,
				participantPeriods,
				centroids: trajectory.centroids,
				paths: trajectory.paths
			}
		},
		summary: {
			dimensions: exchange.dimensions.length,
			points: points.length,
			nodes: nodes.length,
			edges: edges.length,
			lineWeightRows: metadataRows,
			groups: trajectory.groupOrder.length,
			timePoints: resolved.timeOrder.length,
			participantPeriods: participantPeriods.length,
			trajectoryCentroids: trajectory.centroids.length
		},
		diagnostics,
		provenance: {
			adapter: "@3dena/analysis",
			adapterVersion: "0.1.0",
			coordinateSpace: "precomputed-import",
			computation: "reduction-only",
			jenaExecuted: false,
			resolvedMapping: {
				participant: [...input.mapping.participant],
				participantLabel: input.mapping.participantLabel,
				group: input.mapping.group,
				time: input.mapping.time,
				timeOrder: [...input.mapping.timeOrder],
				cohortPolicy: input.mapping.cohortPolicy,
				displayDimensions: [...input.mapping.displayDimensions],
				missingDisplayCoordinates: "reject"
			}
		}
	};
}
//#endregion
//#region packages/analysis/src/trajectory-statistics.ts
var DEFAULT_LIMITS = Object.freeze({
	maxPoints: 1e5,
	maxDimensions: 200,
	maxPeriods: 1e3,
	maxParticipants: 5e4,
	maxCells: 5e6,
	maxResamples: 1e4,
	maxTests: 1e4
});
var HARD_LIMITS = Object.freeze({
	maxPoints: 5e5,
	maxDimensions: 500,
	maxPeriods: 1e4,
	maxParticipants: 2e5,
	maxCells: 1e8,
	maxResamples: 1e5,
	maxTests: 1e5
});
var TrajectoryStatisticsError = class extends Error {
	code;
	path;
	constructor(code, path, message) {
		super(`${path}: ${message}`);
		this.name = "TrajectoryStatisticsError";
		this.code = code;
		this.path = path;
	}
};
function reject$2(code, path, message) {
	throw new TrajectoryStatisticsError(code, path, message);
}
function resolveLimits(input) {
	const result = {};
	for (const key of Object.keys(DEFAULT_LIMITS)) {
		const value = input?.[key];
		if (value !== void 0 && (!Number.isSafeInteger(value) || value < 1)) reject$2("INVALID_TRAJECTORY_LIMIT", `limits.${key}`, "must be a positive safe integer");
		if (value !== void 0 && value > HARD_LIMITS[key]) reject$2("TRAJECTORY_LIMIT_ABOVE_CEILING", `limits.${key}`, `must not exceed ${HARD_LIMITS[key]}`);
		result[key] = value ?? DEFAULT_LIMITS[key];
	}
	return result;
}
function scalarToken(component, path) {
	if (typeof component.name !== "string" || component.name.trim() === "") reject$2("INVALID_IDENTITY_COMPONENT", `${path}.name`, "must be a non-empty string");
	if (component.declaredType !== void 0 && (typeof component.declaredType !== "string" || component.declaredType.trim() === "" || component.declaredType.length > 256)) reject$2("INVALID_IDENTITY_COMPONENT", `${path}.declaredType`, "must be a non-empty string of at most 256 UTF-16 code units when present");
	if (component.type === "string") {
		if (typeof component.value !== "string" || component.value.length === 0) reject$2("INVALID_IDENTITY_VALUE", `${path}.value`, "must be a non-empty string for a string component");
		return [
			component.name,
			"string",
			component.declaredType ?? "string",
			component.value
		];
	}
	if (component.type === "boolean") {
		if (typeof component.value !== "boolean") reject$2("INVALID_IDENTITY_VALUE", `${path}.value`, "must be boolean");
		return [
			component.name,
			"boolean",
			component.declaredType ?? "boolean",
			component.value ? "true" : "false"
		];
	}
	if (component.type !== "number" || typeof component.value !== "number" || !Number.isFinite(component.value)) reject$2("INVALID_IDENTITY_VALUE", `${path}.value`, "must be a finite number with type number");
	if (Number.isInteger(component.value) && !Number.isSafeInteger(component.value)) reject$2("UNSAFE_INTEGER_IDENTITY", `${path}.value`, "integer identities above Number.MAX_SAFE_INTEGER must be strings");
	return [
		component.name,
		"number",
		component.declaredType ?? "number",
		Object.is(component.value, -0) ? "-0" : String(component.value)
	];
}
function normalizeIdentity(identity, path) {
	if (!identity || !Array.isArray(identity.components) || identity.components.length === 0) reject$2("INVALID_TRAJECTORY_IDENTITY", path, "must contain at least one typed component");
	const seen = /* @__PURE__ */ new Set();
	const components = identity.components.map((component, index) => {
		if (!component || typeof component !== "object") reject$2("INVALID_IDENTITY_COMPONENT", `${path}.components[${index}]`, "must be an object");
		const token = scalarToken(component, `${path}.components[${index}]`);
		if (seen.has(component.name)) reject$2("DUPLICATE_IDENTITY_COMPONENT", `${path}.components[${index}].name`, "duplicates an earlier component name");
		seen.add(component.name);
		return {
			component: { ...component },
			token
		};
	});
	return {
		components: components.map((entry) => entry.component),
		canonical: JSON.stringify(components.map((entry) => entry.token)),
		display: components.map((entry) => String(entry.component.value)).join(" · ")
	};
}
function normalizeNamespace(value, path) {
	if (typeof value !== "string" || value.trim() === "" || value.length > 256) reject$2("INVALID_TRAJECTORY_NAMESPACE", path, "must be a non-empty string of at most 256 UTF-16 code units");
	return value;
}
function normalizeSeries(input) {
	if (!input || typeof input !== "object") reject$2("INVALID_TRAJECTORY_INPUT", "input", "must be an object");
	const limits = resolveLimits(input.limits);
	const namespace = normalizeNamespace(input.namespace, "input.namespace");
	if (!Array.isArray(input.points) || input.points.length === 0) reject$2("EMPTY_TRAJECTORY_POINTS", "input.points", "must contain at least one point");
	if (input.points.length > limits.maxPoints) reject$2("TRAJECTORY_POINT_LIMIT", "input.points", `exceeds maxPoints=${limits.maxPoints}`);
	if (!Array.isArray(input.dimensions) || input.dimensions.length === 0) reject$2("INVALID_TRAJECTORY_DIMENSIONS", "input.dimensions", "must be non-empty");
	if (input.dimensions.length > limits.maxDimensions) reject$2("TRAJECTORY_DIMENSION_LIMIT", "input.dimensions", `exceeds maxDimensions=${limits.maxDimensions}`);
	if (input.dimensions.some((dimension) => typeof dimension !== "string" || dimension.trim() === "")) reject$2("INVALID_TRAJECTORY_DIMENSIONS", "input.dimensions", "must contain non-empty strings");
	if (new Set(input.dimensions).size !== input.dimensions.length) reject$2("DUPLICATE_TRAJECTORY_DIMENSION", "input.dimensions", "must be unique");
	if (!Array.isArray(input.selectedDimensions) || input.selectedDimensions.length !== 3 || new Set(input.selectedDimensions).size !== 3) reject$2("INVALID_SELECTED_DIMENSIONS", "input.selectedDimensions", "must contain exactly three distinct dimensions");
	const selectedIndexes = input.selectedDimensions.map((dimension, index) => {
		const found = input.dimensions.indexOf(dimension);
		if (found < 0) reject$2("UNKNOWN_SELECTED_DIMENSION", `input.selectedDimensions[${index}]`, `${JSON.stringify(dimension)} is not declared`);
		return found;
	});
	if (!Array.isArray(input.timeOrder) || input.timeOrder.length === 0) reject$2("INVALID_TRAJECTORY_TIME_ORDER", "input.timeOrder", "must be non-empty");
	if (input.timeOrder.length > limits.maxPeriods) reject$2("TRAJECTORY_PERIOD_LIMIT", "input.timeOrder", `exceeds maxPeriods=${limits.maxPeriods}`);
	const timeOrder = input.timeOrder.map((time, index) => normalizeIdentity(time, `input.timeOrder[${index}]`));
	if (new Set(timeOrder.map((time) => time.canonical)).size !== timeOrder.length) reject$2("DUPLICATE_TRAJECTORY_TIME", "input.timeOrder", "contains duplicate typed periods");
	if (input.cohortPolicy !== "available" && input.cohortPolicy !== "complete") reject$2("INVALID_TRAJECTORY_COHORT", "input.cohortPolicy", "must be available or complete");
	const estimand = input.estimand ?? "equal-participant";
	if (estimand !== "equal-participant" && estimand !== "weighted-participant") reject$2("INVALID_TRAJECTORY_ESTIMAND", "input.estimand", "must be equal-participant or weighted-participant");
	const timeKeys = new Set(timeOrder.map((time) => time.canonical));
	const cells = input.points.length * input.dimensions.length;
	if (!Number.isSafeInteger(cells) || cells > limits.maxCells) reject$2("TRAJECTORY_CELL_LIMIT", "input.points", `exceeds maxCells=${limits.maxCells}`);
	const points = input.points.map((point, rowIndex) => {
		const participant = normalizeIdentity(point.participant, `input.points[${rowIndex}].participant`);
		const time = normalizeIdentity(point.time, `input.points[${rowIndex}].time`);
		const stratum = point.stratum === void 0 ? void 0 : normalizeIdentity(point.stratum, `input.points[${rowIndex}].stratum`);
		if (!timeKeys.has(time.canonical)) reject$2("TRAJECTORY_TIME_ORDER_INCOMPLETE", `input.points[${rowIndex}].time`, "observed period is absent from timeOrder");
		if (!Array.isArray(point.coordinates) || point.coordinates.length !== input.dimensions.length) reject$2("TRAJECTORY_COORDINATE_SHAPE", `input.points[${rowIndex}].coordinates`, "must align with dimensions");
		const coordinates = point.coordinates.map((value, dimensionIndex) => {
			if (typeof value !== "number" || !Number.isFinite(value)) reject$2("NON_FINITE_TRAJECTORY_COORDINATE", `input.points[${rowIndex}].coordinates[${dimensionIndex}]`, "must be finite");
			return value;
		});
		if (estimand === "weighted-participant" && (typeof point.weight !== "number" || !Number.isFinite(point.weight) || point.weight <= 0)) reject$2("INVALID_PARTICIPANT_WEIGHT", `input.points[${rowIndex}].weight`, "must be finite and strictly positive for weighted-participant");
		if (estimand === "equal-participant" && point.weight !== void 0) reject$2("UNEXPECTED_PARTICIPANT_WEIGHT", `input.points[${rowIndex}].weight`, "must be omitted for equal-participant");
		return {
			participant,
			time,
			...stratum ? { stratum } : {},
			coordinates,
			weight: point.weight ?? 1,
			rowIndex
		};
	});
	if (new Set(points.map((point) => point.participant.canonical)).size > limits.maxParticipants) reject$2("TRAJECTORY_PARTICIPANT_LIMIT", "input.points", `exceeds maxParticipants=${limits.maxParticipants}`);
	return {
		input,
		namespace,
		dimensions: [...input.dimensions],
		selectedDimensions: [...input.selectedDimensions],
		selectedIndexes,
		estimand,
		timeOrder,
		points,
		limits
	};
}
function euclidean(delta) {
	const result = Math.hypot(...delta);
	if (!Number.isFinite(result)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.computation.distance", "Euclidean distance is outside the finite numeric range");
	return result;
}
function subtract(right, left) {
	return right.map((value, index) => {
		const difference = value - left[index];
		if (!Number.isFinite(difference)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.delta[${index}]`, "coordinate difference is outside the finite numeric range");
		return difference;
	});
}
function scalarDifference(right, left, path) {
	const difference = right - left;
	if (!Number.isFinite(difference)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", path, "difference is outside the finite numeric range");
	return difference;
}
function compareCanonical(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
function mean(rows, dimensions) {
	if (rows.length === 0) return null;
	return Array.from({ length: dimensions }, (_, index) => {
		let sum = 0;
		let correction = 0;
		for (const row of rows) {
			const scaled = row[index] / rows.length;
			const next = sum + scaled;
			if (!Number.isFinite(next)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.mean[${index}]`, "centroid accumulation is outside the finite numeric range");
			correction += Math.abs(sum) >= Math.abs(scaled) ? sum - next + scaled : scaled - next + sum;
			if (!Number.isFinite(correction)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.mean[${index}]`, "centroid correction is outside the finite numeric range");
			sum = next;
		}
		const result = sum + correction;
		if (!Number.isFinite(result)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.mean[${index}]`, "centroid is outside the finite numeric range");
		return result;
	});
}
function weightedMean(rows, weights, dimensions) {
	if (rows.length === 0) return null;
	if (rows.length !== weights.length) reject$2("TRAJECTORY_WEIGHT_SHAPE", "trajectory.computation.weightedMean", "rows and weights must align");
	const weightSum = weights.reduce((sum, weight, index) => {
		if (!Number.isFinite(weight) || weight <= 0) reject$2("INVALID_PARTICIPANT_WEIGHT", `trajectory.computation.weights[${index}]`, "must be finite and strictly positive");
		const next = sum + weight;
		if (!Number.isFinite(next)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.computation.weightSum", "is outside the finite numeric range");
		return next;
	}, 0);
	return Array.from({ length: dimensions }, (_, index) => {
		let sum = 0;
		let correction = 0;
		for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
			const scaled = rows[rowIndex][index] * (weights[rowIndex] / weightSum);
			const next = sum + scaled;
			if (!Number.isFinite(next)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.weightedMean[${index}]`, "centroid accumulation is outside the finite numeric range");
			correction += Math.abs(sum) >= Math.abs(scaled) ? sum - next + scaled : scaled - next + sum;
			if (!Number.isFinite(correction)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.weightedMean[${index}]`, "centroid correction is outside the finite numeric range");
			sum = next;
		}
		const result = sum + correction;
		if (!Number.isFinite(result)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", `trajectory.computation.weightedMean[${index}]`, "centroid is outside the finite numeric range");
		return result;
	});
}
function participantCentroid(rows, coordinates, dimensions, estimand) {
	const values = rows.map(coordinates);
	return estimand === "weighted-participant" ? weightedMean(values, rows.map((row) => row.participantWeight), dimensions) : mean(values, dimensions);
}
function reduceParticipantPeriods(series) {
	const grouped = /* @__PURE__ */ new Map();
	for (const point of series.points) {
		const key = JSON.stringify([
			series.namespace,
			point.participant.canonical,
			point.time.canonical
		]);
		const group = grouped.get(key);
		if (group) group.rows.push(point);
		else grouped.set(key, {
			participant: point.participant,
			time: point.time,
			rows: [point]
		});
	}
	const expected = new Set(series.timeOrder.map((time) => time.canonical));
	const observedByParticipant = /* @__PURE__ */ new Map();
	for (const group of grouped.values()) {
		const observed = observedByParticipant.get(group.participant.canonical) ?? /* @__PURE__ */ new Set();
		observed.add(group.time.canonical);
		observedByParticipant.set(group.participant.canonical, observed);
	}
	const complete = new Set([...observedByParticipant.entries()].filter(([, observed]) => [...expected].every((time) => observed.has(time))).map(([participant]) => participant));
	const timeIndex = new Map(series.timeOrder.map((time, index) => [time.canonical, index]));
	return [...grouped.values()].sort((left, right) => compareCanonical(left.participant.canonical, right.participant.canonical) || timeIndex.get(left.time.canonical) - timeIndex.get(right.time.canonical)).map((group, index) => {
		if (new Set(group.rows.map((row) => row.weight)).size !== 1) reject$2("UNSTABLE_PARTICIPANT_PERIOD_WEIGHT", `input.participantPeriods[${index}].weight`, "must remain constant within a participant-period");
		const fullCoordinates = mean(group.rows.map((row) => row.coordinates), series.dimensions.length);
		return {
			index,
			participant: group.participant,
			time: group.time,
			selectedCoordinates: series.selectedIndexes.map((selected) => fullCoordinates[selected]),
			fullCoordinates,
			sourceRowIndexes: group.rows.map((row) => row.rowIndex).sort((a, b) => a - b),
			participantWeight: group.rows[0].weight,
			includedInCohort: series.input.cohortPolicy === "available" || complete.has(group.participant.canonical)
		};
	});
}
function distanceMetrics(centroids, dimensions) {
	let continuous = true;
	let cumulative = 0;
	return centroids.map((centroid, index) => {
		if (centroid === null) {
			continuous = false;
			return {
				dimensions: [...dimensions],
				delta: null,
				stepDistance: null,
				cumulativeDistance: null
			};
		}
		if (index === 0) return {
			dimensions: [...dimensions],
			delta: null,
			stepDistance: 0,
			cumulativeDistance: 0
		};
		const previous = centroids[index - 1];
		if (previous === null || previous === void 0) {
			continuous = false;
			return {
				dimensions: [...dimensions],
				delta: null,
				stepDistance: null,
				cumulativeDistance: null
			};
		}
		const delta = subtract(centroid, previous);
		const stepDistance = euclidean(delta);
		if (continuous) {
			const nextCumulative = cumulative + stepDistance;
			if (!Number.isFinite(nextCumulative)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", "trajectory.computation.cumulativeDistance", "cumulative path distance is outside the finite numeric range");
			cumulative = nextCumulative;
		}
		return {
			dimensions: [...dimensions],
			delta,
			stepDistance,
			cumulativeDistance: continuous ? cumulative : null
		};
	});
}
function analyzeNormalizedSeries(series) {
	const participantPeriods = reduceParticipantPeriods(series);
	const periods = series.timeOrder.map((time, index) => {
		const rawRows = series.points.filter((point) => point.time.canonical === time.canonical);
		const allParticipantPeriods = participantPeriods.filter((point) => point.time.canonical === time.canonical);
		const used = allParticipantPeriods.filter((point) => point.includedInCohort);
		const fullCentroid = participantCentroid(used, (point) => point.fullCoordinates, series.dimensions.length, series.estimand);
		return {
			index,
			time,
			selectedCentroid: fullCentroid === null ? null : series.selectedIndexes.map((selected) => fullCentroid[selected]),
			fullCentroid,
			nRows: rawRows.length,
			nTotal: allParticipantPeriods.length,
			nUsed: used.length,
			nDuplicateRows: rawRows.length - allParticipantPeriods.length,
			nCohortExcluded: allParticipantPeriods.length - used.length
		};
	});
	const selectedMetrics = distanceMetrics(periods.map((period) => period.selectedCentroid), series.selectedDimensions);
	const fullMetrics = distanceMetrics(periods.map((period) => period.fullCentroid), series.dimensions);
	const outputPeriods = periods.map((period, index) => ({
		...period,
		selected3d: selectedMetrics[index],
		fullSpace: fullMetrics[index]
	}));
	const participantCount = new Set(participantPeriods.map((point) => point.participant.canonical)).size;
	const duplicateRows = outputPeriods.reduce((sum, period) => sum + period.nDuplicateRows, 0);
	const diagnostics = [];
	if (duplicateRows > 0) diagnostics.push({
		code: "DUPLICATE_PARTICIPANT_PERIOD_ROWS",
		severity: "info",
		message: "Duplicate rows were averaged before centroid calculation."
	});
	if (outputPeriods.some((period) => period.nUsed === 0)) diagnostics.push({
		code: "MISSING_TRAJECTORY_PERIOD",
		severity: "warning",
		message: "At least one requested period has no usable centroid; paths do not bridge gaps."
	});
	if (series.input.cohortPolicy === "available") {
		const signatures = outputPeriods.map((period) => participantPeriods.filter((point) => point.includedInCohort && point.time.canonical === period.time.canonical).map((point) => point.participant.canonical).sort().join("\0"));
		if (new Set(signatures).size > 1) diagnostics.push({
			code: "CHANGING_AVAILABLE_COHORT",
			severity: "warning",
			message: "Participant composition changes across requested periods."
		});
	}
	return deepFreeze$1({
		schemaVersion: "3dena.trajectory-path-statistics.v1",
		namespace: series.namespace,
		cohortPolicy: series.input.cohortPolicy,
		estimand: series.estimand,
		dimensions: [...series.dimensions],
		selectedDimensions: [...series.selectedDimensions],
		distanceSemantics: {
			selected3d: "euclidean-selected-three-dimensions",
			fullSpace: "euclidean-all-declared-dimensions"
		},
		participantPeriods,
		periods: outputPeriods,
		diagnostics,
		summary: {
			inputRows: series.points.length,
			participants: participantCount,
			participantPeriods: participantPeriods.length,
			periods: series.timeOrder.length,
			duplicateRows
		},
		resolvedLimits: { ...series.limits }
	});
}
function analyzeTrajectoryPath(input) {
	return analyzeNormalizedSeries(normalizeSeries(input));
}
function assertComparable(left, right) {
	if (JSON.stringify(left.dimensions) !== JSON.stringify(right.dimensions)) reject$2("INCOMPATIBLE_TRAJECTORY_DIMENSIONS", "input.sideB.series.dimensions", "must exactly match side A order");
	if (JSON.stringify(left.selectedDimensions) !== JSON.stringify(right.selectedDimensions)) reject$2("INCOMPATIBLE_SELECTED_DIMENSIONS", "input.sideB.series.selectedDimensions", "must exactly match side A");
	if (JSON.stringify(left.timeOrder.map((time) => time.canonical)) !== JSON.stringify(right.timeOrder.map((time) => time.canonical))) reject$2("INCOMPATIBLE_TRAJECTORY_TIME", "input.sideB.series.timeOrder", "must exactly match side A typed order");
	if (left.input.cohortPolicy !== right.input.cohortPolicy) reject$2("INCOMPATIBLE_COHORT_POLICY", "input.sideB.series.cohortPolicy", "must match side A");
	if (left.estimand !== right.estimand) reject$2("INCOMPATIBLE_TRAJECTORY_ESTIMAND", "input.sideB.series.estimand", "must match side A");
}
function pairedIdNames(pairedId, path) {
	const names = typeof pairedId === "string" ? [pairedId] : pairedId;
	if (!Array.isArray(names) || names.length === 0 || names.some((name) => typeof name !== "string" || name.trim() === "")) reject$2("INVALID_PAIRED_ID", path, "must be a non-empty component name or non-empty component-name tuple");
	if (new Set(names).size !== names.length) reject$2("INVALID_PAIRED_ID", path, "component-name tuple must not contain duplicates");
	return [...names];
}
function pairingToken(participant, pairedId, path) {
	const names = pairedIdNames(pairedId, "input.pairedId");
	return JSON.stringify(names.map((name) => {
		const matches = participant.components.filter((component) => component.name === name);
		if (matches.length !== 1) reject$2("MISSING_PAIRED_ID", path, `participant identity must contain exactly one ${JSON.stringify(name)} component`);
		return [name, scalarToken(matches[0], `${path}.${name}`)];
	}));
}
function buildComparisonData(input) {
	if (!input || input.design !== "paired" && input.design !== "independent") reject$2("INVALID_COMPARISON_DESIGN", "input.design", "must be paired or independent");
	if (typeof input.sideA?.label !== "string" || input.sideA.label.trim() === "" || typeof input.sideB?.label !== "string" || input.sideB.label.trim() === "") reject$2("INVALID_COMPARISON_LABEL", "input.sideA.label", "both sides require non-empty labels");
	const left = normalizeSeries(input.sideA.series);
	const right = normalizeSeries(input.sideB.series);
	assertComparable(left, right);
	const pathA = analyzeNormalizedSeries(left);
	const pathB = analyzeNormalizedSeries(right);
	if (input.design === "paired") {
		pairedIdNames(input.pairedId, "input.pairedId");
		const maps = [];
		const allPairs = /* @__PURE__ */ new Set();
		for (let timeIndex = 0; timeIndex < left.timeOrder.length; timeIndex += 1) {
			const time = left.timeOrder[timeIndex];
			const aRows = pathA.participantPeriods.filter((row) => row.time.canonical === time.canonical);
			const bRows = pathB.participantPeriods.filter((row) => row.time.canonical === time.canonical);
			const a = /* @__PURE__ */ new Map();
			const b = /* @__PURE__ */ new Map();
			for (const row of aRows) {
				const pair = pairingToken(row.participant, input.pairedId, `input.sideA.series.participantPeriods[${row.index}]`);
				if (a.has(pair)) reject$2("DUPLICATE_PAIRED_ID_TIME", `input.sideA.series`, "more than one participant has the paired ID at one time");
				a.set(pair, row);
			}
			for (const row of bRows) {
				const pair = pairingToken(row.participant, input.pairedId, `input.sideB.series.participantPeriods[${row.index}]`);
				if (b.has(pair)) reject$2("DUPLICATE_PAIRED_ID_TIME", `input.sideB.series`, "more than one participant has the paired ID at one time");
				b.set(pair, row);
			}
			const aKeys = [...a.keys()].sort();
			const bKeys = [...b.keys()].sort();
			if (JSON.stringify(aKeys) !== JSON.stringify(bKeys)) reject$2("UNMATCHED_PAIRED_ID_TIME", `input.timeOrder[${timeIndex}]`, "paired sides must contain exactly the same paired IDs at every observed slice");
			const matched = /* @__PURE__ */ new Map();
			for (const key of aKeys) {
				matched.set(key, [a.get(key), b.get(key)]);
				allPairs.add(key);
			}
			maps.push(matched);
		}
		return {
			left,
			right,
			pathA,
			pathB,
			unitOrder: [...allPairs].filter((pair) => left.input.cohortPolicy === "available" || maps.every((map) => {
				const matched = map.get(pair);
				return matched !== void 0 && matched[0].includedInCohort && matched[1].includedInCohort;
			})).sort(),
			sideACount: null,
			pairedMaps: maps
		};
	}
	if (left.namespace === right.namespace) reject$2("INDEPENDENT_NAMESPACE_COLLISION", "input.sideB.series.namespace", "independent sides must use distinct namespaces");
	const sideAUnits = groupParticipantPeriods(pathA.participantPeriods, left.namespace);
	const sideBUnits = groupParticipantPeriods(pathB.participantPeriods, right.namespace);
	const units = [...sideAUnits, ...sideBUnits].sort((a, b) => compareCanonical(a.key, b.key));
	return {
		left,
		right,
		pathA,
		pathB,
		unitOrder: units.map((unit) => unit.key),
		sideACount: sideAUnits.length,
		independentUnits: units
	};
}
function groupParticipantPeriods(rows, namespace) {
	const groups = /* @__PURE__ */ new Map();
	for (const row of rows.filter((entry) => entry.includedInCohort)) {
		const key = JSON.stringify([namespace, row.participant.canonical]);
		const current = groups.get(key) ?? [];
		current.push(row);
		groups.set(key, current);
	}
	return [...groups.entries()].map(([key, periods]) => ({
		key,
		periods
	}));
}
function getTrajectoryPermutationUnits(input) {
	const data = buildComparisonData(input);
	return {
		design: input.design,
		unitOrder: [...data.unitOrder],
		sideACount: data.sideACount
	};
}
function baseCentroidRows(data, design) {
	if (design === "paired") return data.left.timeOrder.map((time, timeIndex) => {
		const accepted = [...data.pairedMaps[timeIndex].values()].filter(([a, b]) => a.includedInCohort && b.includedInCohort);
		return {
			time,
			selectedA: participantCentroid(accepted.map(([a]) => a), (row) => row.selectedCoordinates, 3, data.left.estimand),
			selectedB: participantCentroid(accepted.map(([, b]) => b), (row) => row.selectedCoordinates, 3, data.right.estimand),
			fullA: participantCentroid(accepted.map(([a]) => a), (row) => row.fullCoordinates, data.left.dimensions.length, data.left.estimand),
			fullB: participantCentroid(accepted.map(([, b]) => b), (row) => row.fullCoordinates, data.left.dimensions.length, data.right.estimand),
			nA: accepted.length,
			nB: accepted.length,
			nMatched: accepted.length
		};
	});
	return data.left.timeOrder.map((time) => {
		const a = data.pathA.participantPeriods.filter((row) => row.includedInCohort && row.time.canonical === time.canonical);
		const b = data.pathB.participantPeriods.filter((row) => row.includedInCohort && row.time.canonical === time.canonical);
		return {
			time,
			selectedA: participantCentroid(a, (row) => row.selectedCoordinates, 3, data.left.estimand),
			selectedB: participantCentroid(b, (row) => row.selectedCoordinates, 3, data.right.estimand),
			fullA: participantCentroid(a, (row) => row.fullCoordinates, data.left.dimensions.length, data.left.estimand),
			fullB: participantCentroid(b, (row) => row.fullCoordinates, data.left.dimensions.length, data.right.estimand),
			nA: a.length,
			nB: b.length,
			nMatched: null
		};
	});
}
function comparisonPeriods(rows) {
	const selectedStepA = distanceMetrics(rows.map((row) => row.selectedA), [
		"x",
		"y",
		"z"
	]);
	const selectedStepB = distanceMetrics(rows.map((row) => row.selectedB), [
		"x",
		"y",
		"z"
	]);
	const fullStepA = distanceMetrics(rows.map((row) => row.fullA), []);
	const fullStepB = distanceMetrics(rows.map((row) => row.fullB), []);
	return rows.map((row, index) => {
		const selectedDifference = row.selectedA && row.selectedB ? subtract(row.selectedB, row.selectedA) : null;
		const fullDifference = row.fullA && row.fullB ? subtract(row.fullB, row.fullA) : null;
		const selectedA = selectedStepA[index].stepDistance;
		const selectedB = selectedStepB[index].stepDistance;
		const selectedCumulativeA = selectedStepA[index].cumulativeDistance;
		const selectedCumulativeB = selectedStepB[index].cumulativeDistance;
		const fullA = fullStepA[index].stepDistance;
		const fullB = fullStepB[index].stepDistance;
		const fullCumulativeA = fullStepA[index].cumulativeDistance;
		const fullCumulativeB = fullStepB[index].cumulativeDistance;
		return {
			index,
			time: row.time,
			selectedCentroidA: row.selectedA,
			selectedCentroidB: row.selectedB,
			selectedDifference,
			fullCentroidA: row.fullA,
			fullCentroidB: row.fullB,
			fullDifference,
			selectedCentroidSeparation: selectedDifference ? euclidean(selectedDifference) : null,
			fullCentroidSeparation: fullDifference ? euclidean(fullDifference) : null,
			selectedStepDistanceA: selectedA,
			selectedStepDistanceB: selectedB,
			selectedStepDistanceDifference: selectedA !== null && selectedB !== null ? scalarDifference(selectedB, selectedA, `comparison.periods[${index}].selectedStepDistanceDifference`) : null,
			selectedCumulativeDistanceA: selectedCumulativeA,
			selectedCumulativeDistanceB: selectedCumulativeB,
			selectedCumulativeDistanceDifference: selectedCumulativeA !== null && selectedCumulativeB !== null ? scalarDifference(selectedCumulativeB, selectedCumulativeA, `comparison.periods[${index}].selectedCumulativeDistanceDifference`) : null,
			fullStepDistanceA: fullA,
			fullStepDistanceB: fullB,
			fullStepDistanceDifference: fullA !== null && fullB !== null ? scalarDifference(fullB, fullA, `comparison.periods[${index}].fullStepDistanceDifference`) : null,
			fullCumulativeDistanceA: fullCumulativeA,
			fullCumulativeDistanceB: fullCumulativeB,
			fullCumulativeDistanceDifference: fullCumulativeA !== null && fullCumulativeB !== null ? scalarDifference(fullCumulativeB, fullCumulativeA, `comparison.periods[${index}].fullCumulativeDistanceDifference`) : null,
			nAUsed: row.nA,
			nBUsed: row.nB,
			nMatched: row.nMatched
		};
	});
}
function metricDescriptors(periods, selectedDimensions) {
	const output = [];
	for (const period of periods) {
		period.selectedDifference?.forEach((value, dimensionIndex) => output.push({
			id: `t${period.index}:coordinate:${selectedDimensions[dimensionIndex]}`,
			timeIndex: period.index,
			metric: `coordinate:${selectedDimensions[dimensionIndex]}`,
			distanceSpace: null,
			tail: "two-sided",
			observed: value
		}));
		if (period.selectedCentroidSeparation !== null) output.push({
			id: `t${period.index}:centroid-separation:selected`,
			timeIndex: period.index,
			metric: "centroid-separation",
			distanceSpace: "selected-3d",
			tail: "upper",
			observed: period.selectedCentroidSeparation
		});
		if (period.fullCentroidSeparation !== null) output.push({
			id: `t${period.index}:centroid-separation:full`,
			timeIndex: period.index,
			metric: "centroid-separation",
			distanceSpace: "full-space",
			tail: "upper",
			observed: period.fullCentroidSeparation
		});
		if (period.index > 0 && period.selectedStepDistanceDifference !== null) output.push({
			id: `t${period.index}:step-distance:selected`,
			timeIndex: period.index,
			metric: "step-distance-difference",
			distanceSpace: "selected-3d",
			tail: "two-sided",
			observed: period.selectedStepDistanceDifference
		});
		if (period.index > 0 && period.fullStepDistanceDifference !== null) output.push({
			id: `t${period.index}:step-distance:full`,
			timeIndex: period.index,
			metric: "step-distance-difference",
			distanceSpace: "full-space",
			tail: "two-sided",
			observed: period.fullStepDistanceDifference
		});
		if (period.index > 0 && period.selectedCumulativeDistanceDifference !== null) output.push({
			id: `t${period.index}:cumulative-distance:selected`,
			timeIndex: period.index,
			metric: "cumulative-distance-difference",
			distanceSpace: "selected-3d",
			tail: "two-sided",
			observed: period.selectedCumulativeDistanceDifference
		});
		if (period.index > 0 && period.fullCumulativeDistanceDifference !== null) output.push({
			id: `t${period.index}:cumulative-distance:full`,
			timeIndex: period.index,
			metric: "cumulative-distance-difference",
			distanceSpace: "full-space",
			tail: "two-sided",
			observed: period.fullCumulativeDistanceDifference
		});
	}
	return output;
}
function metricMap(periods, selectedDimensions) {
	return new Map(metricDescriptors(periods, selectedDimensions).map((metric) => [metric.id, metric.observed]));
}
function validateUnitOrder(actual, expected, path) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) reject$2("PERMUTATION_UNIT_ORDER_MISMATCH", path, "must exactly match getTrajectoryPermutationUnits()");
}
function validateIndexList(indexes, size, path, requirePermutation) {
	if (!Array.isArray(indexes) || indexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= size)) reject$2("INVALID_PERMUTATION_INDEX", path, `indexes must be safe integers in [0, ${size})`);
	if (new Set(indexes).size !== indexes.length) reject$2("DUPLICATE_PERMUTATION_INDEX", path, "must not repeat indexes");
	if (requirePermutation && indexes.length !== size) reject$2("INCOMPLETE_PERMUTATION", path, "must contain every unit index exactly once");
}
function permutedCentroidRows(data, input, replicate) {
	if (input.design === "paired") {
		const swaps = new Set(replicate);
		return data.left.timeOrder.map((time, timeIndex) => {
			const entries = [...data.pairedMaps[timeIndex].entries()].filter(([, [a, b]]) => a.includedInCohort && b.includedInCohort);
			const aRows = [];
			const bRows = [];
			for (const [pair, [a, b]] of entries) {
				const swap = swaps.has(data.unitOrder.indexOf(pair));
				aRows.push(swap ? b : a);
				bRows.push(swap ? a : b);
			}
			return {
				time,
				selectedA: participantCentroid(aRows, (row) => row.selectedCoordinates, 3, data.left.estimand),
				selectedB: participantCentroid(bRows, (row) => row.selectedCoordinates, 3, data.right.estimand),
				fullA: participantCentroid(aRows, (row) => row.fullCoordinates, data.left.dimensions.length, data.left.estimand),
				fullB: participantCentroid(bRows, (row) => row.fullCoordinates, data.left.dimensions.length, data.right.estimand),
				nA: entries.length,
				nB: entries.length,
				nMatched: entries.length
			};
		});
	}
	const aIndexes = new Set(replicate.slice(0, data.sideACount));
	const sideA = data.independentUnits.filter((_, index) => aIndexes.has(index)).flatMap((unit) => unit.periods);
	const sideB = data.independentUnits.filter((_, index) => !aIndexes.has(index)).flatMap((unit) => unit.periods);
	return data.left.timeOrder.map((time) => {
		const a = sideA.filter((row) => row.time.canonical === time.canonical);
		const b = sideB.filter((row) => row.time.canonical === time.canonical);
		return {
			time,
			selectedA: participantCentroid(a, (row) => row.selectedCoordinates, 3, data.left.estimand),
			selectedB: participantCentroid(b, (row) => row.selectedCoordinates, 3, data.right.estimand),
			fullA: participantCentroid(a, (row) => row.fullCoordinates, data.left.dimensions.length, data.left.estimand),
			fullB: participantCentroid(b, (row) => row.fullCoordinates, data.left.dimensions.length, data.right.estimand),
			nA: a.length,
			nB: b.length,
			nMatched: null
		};
	});
}
function holmAdjust(pValues) {
	pValues.forEach((value, index) => {
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) reject$2("INVALID_P_VALUE", `pValues[${index}]`, "must be finite in [0, 1]");
	});
	const ordered = pValues.map((value, index) => ({
		value,
		index
	})).sort((a, b) => a.value - b.value || a.index - b.index);
	const adjusted = Array.from({ length: pValues.length }, () => 0);
	let running = 0;
	ordered.forEach((entry, rank) => {
		running = Math.max(running, Math.min(1, entry.value * (pValues.length - rank)));
		adjusted[entry.index] = running;
	});
	return adjusted;
}
function permutationTests(data, input, observedPeriods) {
	const plan = input.permutationPlan;
	if (!plan) return [];
	validateUnitOrder(plan.unitOrder, data.unitOrder, "input.permutationPlan.unitOrder");
	const limit = Math.min(data.left.limits.maxResamples, data.right.limits.maxResamples);
	if (!Array.isArray(plan.replicates) || plan.replicates.length === 0 || plan.replicates.length > limit) reject$2("INVALID_PERMUTATION_PLAN", "input.permutationPlan.replicates", `must contain 1..${limit} replicates`);
	if (input.design === "paired" && plan.kind !== "paired-swap-indices-v1") reject$2("PERMUTATION_DESIGN_MISMATCH", "input.permutationPlan.kind", "paired comparison requires paired-swap-indices-v1");
	if (input.design === "independent" && plan.kind !== "independent-pool-indices-v1") reject$2("PERMUTATION_DESIGN_MISMATCH", "input.permutationPlan.kind", "independent comparison requires independent-pool-indices-v1");
	plan.replicates.forEach((replicate, index) => validateIndexList(replicate, data.unitOrder.length, `input.permutationPlan.replicates[${index}]`, input.design === "independent"));
	const observed = metricDescriptors(observedPeriods, data.left.selectedDimensions);
	if (observed.length > Math.min(data.left.limits.maxTests, data.right.limits.maxTests)) reject$2("TRAJECTORY_TEST_LIMIT", "comparison.tests", "exceeds configured maxTests");
	const values = observed.map(() => []);
	for (const replicate of plan.replicates) {
		const map = metricMap(comparisonPeriods(permutedCentroidRows(data, input, replicate)), data.left.selectedDimensions);
		observed.forEach((metric, index) => {
			const value = map.get(metric.id);
			if (value !== void 0 && Number.isFinite(value)) values[index].push(value);
		});
	}
	const raw = observed.map((metric, index) => {
		const permutations = values[index];
		return (1 + permutations.filter((value) => metric.tail === "upper" ? value >= metric.observed : Math.abs(value) >= Math.abs(metric.observed)).length) / (1 + permutations.length);
	});
	const adjusted = holmAdjust(raw);
	return observed.map((metric, index) => ({
		...metric,
		pValue: raw[index],
		holmAdjustedPValue: adjusted[index],
		permutationCount: values[index].length
	}));
}
function compareTrajectoryPaths(input) {
	const data = buildComparisonData(input);
	const periods = comparisonPeriods(baseCentroidRows(data, input.design));
	const tests = permutationTests(data, input, periods);
	const diagnostics = [];
	if (periods.some((period) => period.nAUsed < 2 || period.nBUsed < 2)) diagnostics.push({
		code: "DEGENERATE_COMPARISON_GROUP",
		severity: "warning",
		message: "At least one comparison slice has fewer than two participant clusters."
	});
	if (!input.permutationPlan) diagnostics.push({
		code: "PERMUTATION_NOT_REQUESTED",
		severity: "info",
		message: "No p-values were computed because no caller-bound permutation plan was supplied."
	});
	return deepFreeze$1({
		schemaVersion: "3dena.trajectory-comparison.v1",
		design: input.design,
		direction: "B-minus-A",
		pairedId: input.design === "paired" ? Array.isArray(input.pairedId) ? [...input.pairedId] : input.pairedId : null,
		sideA: data.pathA,
		sideB: data.pathB,
		periods,
		tests,
		permutation: {
			status: input.permutationPlan ? "complete" : "not-requested",
			planKind: input.permutationPlan?.kind ?? null,
			unitOrder: [...data.unitOrder],
			replicateCount: input.permutationPlan?.replicates.length ?? 0,
			rngParityClaim: false
		},
		diagnostics
	});
}
var BOOTSTRAP_DRAW_COMPONENT = "@3dena/bootstrap-draw-v1";
function allStratum() {
	return normalizeIdentity({ components: [{
		name: "@3dena/bootstrap-stratum",
		type: "string",
		value: "all"
	}] }, "bootstrap.stratum");
}
function buildBootstrapContext(input) {
	if (input.stratifyBy !== "none" && input.stratifyBy !== "explicit") reject$2("INVALID_BOOTSTRAP_STRATIFICATION", "input.stratifyBy", "must be none or explicit");
	const series = normalizeSeries(input.series);
	const base = analyzeNormalizedSeries(series);
	const eligible = new Set(base.participantPeriods.filter((row) => row.includedInCohort).map((row) => row.participant.canonical));
	const grouped = /* @__PURE__ */ new Map();
	for (const point of series.points) {
		if (!eligible.has(point.participant.canonical)) continue;
		if (point.participant.components.some((component) => component.name === BOOTSTRAP_DRAW_COMPONENT)) reject$2("RESERVED_BOOTSTRAP_IDENTITY", `input.series.points[${point.rowIndex}].participant`, `must not contain ${BOOTSTRAP_DRAW_COMPONENT}`);
		const current = grouped.get(point.participant.canonical) ?? [];
		current.push(point);
		grouped.set(point.participant.canonical, current);
	}
	const histories = [...grouped.entries()].map(([participantCanonical, points]) => {
		const participant = points[0].participant;
		let stratum = allStratum();
		if (input.stratifyBy === "explicit") {
			if (points.some((point) => point.stratum === void 0)) reject$2("MISSING_BOOTSTRAP_STRATUM", `input.series.participant.${participant.display}`, "every eligible participant row requires an explicit stratum");
			const strata = new Map(points.map((point) => [point.stratum.canonical, point.stratum]));
			if (strata.size !== 1) reject$2("UNSTABLE_BOOTSTRAP_STRATUM", `input.series.participant.${participant.display}`, "stratum must remain constant across the complete participant history");
			stratum = [...strata.values()][0];
		}
		return {
			key: JSON.stringify([series.namespace, participantCanonical]),
			participant,
			stratum,
			points: [...points].sort((left, right) => left.rowIndex - right.rowIndex)
		};
	}).sort((left, right) => compareCanonical(left.key, right.key));
	if (histories.length === 0) reject$2("EMPTY_BOOTSTRAP_POOL", "input.series", "cohort policy leaves no eligible participant histories");
	const stratumMap = /* @__PURE__ */ new Map();
	histories.forEach((history, index) => {
		const current = stratumMap.get(history.stratum.canonical) ?? {
			key: history.stratum,
			unitIndexes: []
		};
		current.unitIndexes.push(index);
		stratumMap.set(history.stratum.canonical, current);
	});
	const strata = [...stratumMap.values()].sort((left, right) => compareCanonical(left.key.canonical, right.key.canonical));
	return {
		series,
		base,
		histories,
		units: deepFreeze$1({
			schemaVersion: "3dena.trajectory-bootstrap-units.v1",
			unitOrder: histories.map((history) => history.key),
			strata: strata.map((stratum) => ({
				key: stratum.key,
				unitIndexes: [...stratum.unitIndexes]
			})),
			cohortPolicy: input.series.cohortPolicy,
			stratifyBy: input.stratifyBy
		})
	};
}
function getTrajectoryBootstrapUnits(input) {
	return buildBootstrapContext(input).units;
}
function validateBootstrapUnits(units) {
	if (!units || units.schemaVersion !== "3dena.trajectory-bootstrap-units.v1" || !Array.isArray(units.unitOrder) || units.unitOrder.length === 0) reject$2("INVALID_BOOTSTRAP_UNITS", "input.units", "must come from getTrajectoryBootstrapUnits()");
	if (new Set(units.unitOrder).size !== units.unitOrder.length) reject$2("DUPLICATE_BOOTSTRAP_UNIT", "input.units.unitOrder", "must contain unique units");
	const strata = /* @__PURE__ */ new Set();
	const indexes = /* @__PURE__ */ new Set();
	for (const [stratumIndex, stratum] of units.strata.entries()) {
		if (strata.has(stratum.key.canonical)) reject$2("DUPLICATE_BOOTSTRAP_STRATUM", `input.units.strata[${stratumIndex}]`, "duplicates a stratum key");
		strata.add(stratum.key.canonical);
		if (stratum.unitIndexes.length === 0) reject$2("EMPTY_BOOTSTRAP_STRATUM", `input.units.strata[${stratumIndex}]`, "must contain at least one unit");
		for (const index of stratum.unitIndexes) {
			if (!Number.isSafeInteger(index) || index < 0 || index >= units.unitOrder.length) reject$2("INVALID_BOOTSTRAP_INDEX", `input.units.strata[${stratumIndex}].unitIndexes`, "contains an out-of-range index");
			if (indexes.has(index)) reject$2("DUPLICATE_BOOTSTRAP_UNIT", `input.units.strata[${stratumIndex}].unitIndexes`, "a unit may belong to only one stratum");
			indexes.add(index);
		}
	}
	if (indexes.size !== units.unitOrder.length) reject$2("MISSING_BOOTSTRAP_UNIT", "input.units.strata", "strata must partition every unit exactly once");
}
function mulberry32$1(seed) {
	let state = seed >>> 0;
	return () => {
		state = state + 1831565813 >>> 0;
		let value = state;
		value = Math.imul(value ^ value >>> 15, value | 1);
		value ^= value + Math.imul(value ^ value >>> 7, value | 61);
		return ((value ^ value >>> 14) >>> 0) / 4294967296;
	};
}
function createSeededTrajectoryBootstrapPlan(input) {
	validateBootstrapUnits(input.units);
	const limits = resolveLimits(input.limits);
	if (!Number.isSafeInteger(input.repetitions) || input.repetitions < 1 || input.repetitions > limits.maxResamples) reject$2("BOOTSTRAP_RESAMPLE_LIMIT", "input.repetitions", `must be a safe integer in [1, ${limits.maxResamples}]`);
	if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 4294967295) reject$2("INVALID_BOOTSTRAP_SEED", "input.seed", "must be an unsigned 32-bit integer");
	const planCells = input.repetitions * input.units.unitOrder.length;
	if (!Number.isSafeInteger(planCells) || planCells > limits.maxCells) reject$2("BOOTSTRAP_CELL_LIMIT", "input.repetitions", `plan indexes exceed maxCells=${limits.maxCells}`);
	const random = mulberry32$1(input.seed);
	return deepFreeze$1({
		kind: "participant-history-resample-indices-v1",
		unitOrder: [...input.units.unitOrder],
		strata: input.units.strata.map((stratum) => ({
			key: stratum.key,
			unitIndexes: [...stratum.unitIndexes],
			replicates: Array.from({ length: input.repetitions }, () => Array.from({ length: stratum.unitIndexes.length }, () => stratum.unitIndexes[Math.floor(random() * stratum.unitIndexes.length)]))
		})),
		generation: {
			kind: "seeded",
			algorithm: "mulberry32-uint32-v1",
			seed: input.seed,
			unitSort: "utf16-code-unit-ascending",
			randomEndpoint: "zero-inclusive-one-exclusive"
		}
	});
}
function validateBootstrapPlan(plan, context) {
	if (!plan || plan.kind !== "participant-history-resample-indices-v1") reject$2("INVALID_BOOTSTRAP_PLAN", "input.plan.kind", "must be participant-history-resample-indices-v1");
	if (JSON.stringify(plan.unitOrder) !== JSON.stringify(context.units.unitOrder)) reject$2("BOOTSTRAP_UNIT_ORDER_MISMATCH", "input.plan.unitOrder", "must exactly match getTrajectoryBootstrapUnits()");
	const seenStrata = /* @__PURE__ */ new Set();
	if (!Array.isArray(plan.strata) || plan.strata.length !== context.units.strata.length) reject$2("BOOTSTRAP_STRATA_MISMATCH", "input.plan.strata", "must exactly match the resolved strata");
	let repetitions;
	let planIndexCells = 0;
	plan.strata.forEach((stratum, stratumIndex) => {
		if (seenStrata.has(stratum.key.canonical)) reject$2("DUPLICATE_BOOTSTRAP_STRATUM", `input.plan.strata[${stratumIndex}]`, "duplicates a stratum key");
		seenStrata.add(stratum.key.canonical);
		const expected = context.units.strata[stratumIndex];
		if (stratum.key.canonical !== expected.key.canonical || JSON.stringify(stratum.unitIndexes) !== JSON.stringify(expected.unitIndexes)) reject$2("BOOTSTRAP_STRATA_MISMATCH", `input.plan.strata[${stratumIndex}]`, "key and unitIndexes must exactly match getTrajectoryBootstrapUnits()");
		if (!Array.isArray(stratum.replicates) || stratum.replicates.length === 0) reject$2("INVALID_BOOTSTRAP_PLAN", `input.plan.strata[${stratumIndex}].replicates`, "must be non-empty");
		if (repetitions === void 0) repetitions = stratum.replicates.length;
		if (stratum.replicates.length !== repetitions) reject$2("BOOTSTRAP_REPLICATE_MISMATCH", `input.plan.strata[${stratumIndex}].replicates`, "every stratum must have the same replicate count");
		const allowed = new Set(expected.unitIndexes);
		stratum.replicates.forEach((draw, replicateIndex) => {
			if (!Array.isArray(draw) || draw.length !== expected.unitIndexes.length) reject$2("BOOTSTRAP_SAMPLE_SIZE_MISMATCH", `input.plan.strata[${stratumIndex}].replicates[${replicateIndex}]`, "must preserve the original stratum sample size");
			draw.forEach((index, drawIndex) => {
				if (!Number.isSafeInteger(index) || !allowed.has(index)) reject$2("INVALID_BOOTSTRAP_INDEX", `input.plan.strata[${stratumIndex}].replicates[${replicateIndex}][${drawIndex}]`, "must reference a unit inside the same stratum");
			});
			planIndexCells += draw.length;
			if (!Number.isSafeInteger(planIndexCells)) reject$2("BOOTSTRAP_OVERFLOW", "input.plan", "index cell count overflowed safe integer arithmetic");
		});
	});
	const count = repetitions ?? 0;
	if (count > context.series.limits.maxResamples) reject$2("BOOTSTRAP_RESAMPLE_LIMIT", "input.plan", `exceeds maxResamples=${context.series.limits.maxResamples}`);
	if (planIndexCells > context.series.limits.maxCells) reject$2("BOOTSTRAP_CELL_LIMIT", "input.plan", `plan indexes exceed maxCells=${context.series.limits.maxCells}`);
	if (!plan.generation || typeof plan.generation !== "object") reject$2("INVALID_BOOTSTRAP_GENERATION", "input.plan.generation", "must identify caller-provided or seeded plan custody");
	if (plan.generation.kind === "caller-provided") return {
		repetitions: count,
		generation: { kind: "caller-provided" }
	};
	if (plan.generation.kind !== "seeded" || plan.generation.algorithm !== "mulberry32-uint32-v1" || plan.generation.unitSort !== "utf16-code-unit-ascending" || plan.generation.randomEndpoint !== "zero-inclusive-one-exclusive" || !Number.isSafeInteger(plan.generation.seed) || plan.generation.seed < 0 || plan.generation.seed > 4294967295) reject$2("INVALID_BOOTSTRAP_GENERATION", "input.plan.generation", "seeded custody must use the frozen v1 algorithm, sort, endpoint, and uint32 seed");
	const expected = createSeededTrajectoryBootstrapPlan({
		units: context.units,
		repetitions: count,
		seed: plan.generation.seed,
		limits: context.series.limits
	});
	const suppliedDraws = plan.strata.map((stratum) => stratum.replicates);
	const expectedDraws = expected.strata.map((stratum) => stratum.replicates);
	if (JSON.stringify(suppliedDraws) !== JSON.stringify(expectedDraws)) reject$2("SEEDED_BOOTSTRAP_PLAN_MISMATCH", "input.plan.strata", "draws do not match the declared frozen algorithm and seed; mark an exact custom plan caller-provided instead");
	return {
		repetitions: count,
		generation: { ...expected.generation }
	};
}
function trajectoryPercentile(values, probability) {
	if (!Array.isArray(values) || values.length === 0) reject$2("EMPTY_BOOTSTRAP_VALUES", "values", "must contain at least one finite number");
	if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) reject$2("INVALID_BOOTSTRAP_PROBABILITY", "probability", "must be finite in [0, 1]");
	const ordered = values.map((value, index) => {
		if (typeof value !== "number" || !Number.isFinite(value)) reject$2("NON_FINITE_BOOTSTRAP_VALUE", `values[${index}]`, "must be finite");
		return value;
	}).sort((left, right) => left - right);
	if (probability === 0) return ordered[0];
	if (probability === 1) return ordered[ordered.length - 1];
	const position = (ordered.length - 1) * probability;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return ordered[lower];
	const fraction = position - lower;
	const result = ordered[lower] * (1 - fraction) + ordered[upper] * fraction;
	if (!Number.isFinite(result)) reject$2("TRAJECTORY_NUMERIC_OVERFLOW", "values", "interpolated percentile is outside the finite numeric range");
	return result;
}
function cloneBootstrapSeries(context, plan, replicateIndex) {
	const points = [];
	let drawSequence = 0;
	for (const stratum of plan.strata) for (const unitIndex of stratum.replicates[replicateIndex]) {
		const history = context.histories[unitIndex];
		const clonedParticipant = { components: [...history.participant.components.map((component) => ({ ...component })), {
			name: BOOTSTRAP_DRAW_COMPONENT,
			type: "number",
			value: drawSequence
		}] };
		drawSequence += 1;
		for (const point of history.points) points.push({
			participant: clonedParticipant,
			time: { components: point.time.components.map((component) => ({ ...component })) },
			coordinates: [...point.coordinates],
			...context.series.estimand === "weighted-participant" ? { weight: point.weight } : {}
		});
	}
	if (points.length > context.series.limits.maxPoints) reject$2("BOOTSTRAP_POINT_LIMIT", `replicates[${replicateIndex}]`, `exceeds maxPoints=${context.series.limits.maxPoints}`);
	return {
		namespace: context.series.namespace,
		points,
		dimensions: [...context.series.dimensions],
		selectedDimensions: [...context.series.selectedDimensions],
		timeOrder: context.series.timeOrder.map((time) => ({ components: time.components.map((component) => ({ ...component })) })),
		cohortPolicy: context.series.input.cohortPolicy,
		estimand: context.series.estimand,
		limits: { ...context.series.input.limits }
	};
}
function bootstrapInterval(estimate, values, clusterEligible, confidenceLevel, repetitions, requiredFinite) {
	if (estimate === null || !clusterEligible) return null;
	const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
	if (finite.length < requiredFinite) return null;
	const alpha = 1 - confidenceLevel;
	return {
		estimate,
		lower: trajectoryPercentile(finite, alpha / 2),
		upper: trajectoryPercentile(finite, 1 - alpha / 2),
		finiteReplicates: finite.length,
		requiredFiniteReplicates: requiredFinite,
		totalReplicates: repetitions
	};
}
function bootstrapTrajectoryPath(input) {
	if (typeof input.confidenceLevel !== "number" || !Number.isFinite(input.confidenceLevel) || input.confidenceLevel <= 0 || input.confidenceLevel >= 1) reject$2("INVALID_BOOTSTRAP_CONFIDENCE", "input.confidenceLevel", "must be finite and strictly between 0 and 1");
	const context = buildBootstrapContext({
		series: input.series,
		stratifyBy: input.stratifyBy
	});
	const validatedPlan = validateBootstrapPlan(input.plan, context);
	const repetitions = validatedPlan.repetitions;
	let computationalCells = 0;
	for (let replicate = 0; replicate < repetitions; replicate += 1) for (const stratum of input.plan.strata) for (const unitIndex of stratum.replicates[replicate]) {
		const cells = context.histories[unitIndex].points.length * context.series.dimensions.length;
		if (!Number.isSafeInteger(cells) || computationalCells > Number.MAX_SAFE_INTEGER - cells) reject$2("BOOTSTRAP_OVERFLOW", "input.plan", "resampled coordinate cell count overflowed safe integer arithmetic");
		computationalCells += cells;
	}
	if (computationalCells > context.series.limits.maxCells) reject$2("BOOTSTRAP_CELL_LIMIT", "input.plan", `resampled coordinates exceed maxCells=${context.series.limits.maxCells}`);
	const replicatePaths = Array.from({ length: repetitions }, (_, replicate) => analyzeTrajectoryPath(cloneBootstrapSeries(context, input.plan, replicate)));
	const requiredFinite = Math.max(Math.ceil(.8 * repetitions), Math.ceil(10 / (1 - input.confidenceLevel) - 1e-12));
	let insufficientClusters = false;
	let insufficientReplicates = false;
	let anyCentroidVariation = false;
	const periods = context.base.periods.map((basePeriod, periodIndex) => {
		const centroidEligible = basePeriod.nUsed >= 2;
		const stepEligible = periodIndex > 0 && centroidEligible && context.base.periods[periodIndex - 1].nUsed >= 2;
		const cumulativeEligible = centroidEligible && context.base.periods.slice(0, periodIndex + 1).every((period) => period.nUsed >= 2);
		if (!centroidEligible || periodIndex > 0 && (!stepEligible || !cumulativeEligible)) insufficientClusters = true;
		const selectedCentroid = Array.from({ length: 3 }, (_, dimension) => {
			const values = replicatePaths.map((path) => path.periods[periodIndex].selectedCentroid?.[dimension] ?? null);
			const interval = bootstrapInterval(basePeriod.selectedCentroid?.[dimension] ?? null, values, centroidEligible, input.confidenceLevel, repetitions, requiredFinite);
			if (centroidEligible && basePeriod.selectedCentroid !== null && interval === null) insufficientReplicates = true;
			return interval;
		});
		const fullCentroid = Array.from({ length: context.series.dimensions.length }, (_, dimension) => {
			const values = replicatePaths.map((path) => path.periods[periodIndex].fullCentroid?.[dimension] ?? null);
			const finiteValues = values.filter((value) => typeof value === "number" && Number.isFinite(value));
			if (finiteValues.length > 1 && finiteValues.some((value) => value !== finiteValues[0])) anyCentroidVariation = true;
			const interval = bootstrapInterval(basePeriod.fullCentroid?.[dimension] ?? null, values, centroidEligible, input.confidenceLevel, repetitions, requiredFinite);
			if (centroidEligible && basePeriod.fullCentroid !== null && interval === null) insufficientReplicates = true;
			return interval;
		});
		const scalar = (estimate, selector, eligible) => {
			const interval = bootstrapInterval(estimate, replicatePaths.map(selector), eligible, input.confidenceLevel, repetitions, requiredFinite);
			if (eligible && estimate !== null && interval === null) insufficientReplicates = true;
			return interval;
		};
		return {
			index: periodIndex,
			time: basePeriod.time,
			selectedCentroid,
			fullCentroid,
			selectedStepDistance: scalar(basePeriod.selected3d.stepDistance, (path) => path.periods[periodIndex].selected3d.stepDistance, stepEligible),
			fullStepDistance: scalar(basePeriod.fullSpace.stepDistance, (path) => path.periods[periodIndex].fullSpace.stepDistance, stepEligible),
			selectedCumulativeDistance: scalar(basePeriod.selected3d.cumulativeDistance, (path) => path.periods[periodIndex].selected3d.cumulativeDistance, cumulativeEligible),
			fullCumulativeDistance: scalar(basePeriod.fullSpace.cumulativeDistance, (path) => path.periods[periodIndex].fullSpace.cumulativeDistance, cumulativeEligible)
		};
	});
	const diagnostics = [];
	if (insufficientClusters) diagnostics.push({
		code: "BOOTSTRAP_INSUFFICIENT_CLUSTERS",
		severity: "warning",
		message: "Intervals requiring fewer than two participant clusters were withheld."
	});
	if (context.units.strata.some((stratum) => stratum.unitIndexes.length === 1)) diagnostics.push({
		code: "BOOTSTRAP_SINGLETON_STRATUM",
		severity: "warning",
		message: "At least one resampling stratum has one participant cluster and contributes no within-stratum resampling variation."
	});
	if (context.histories.length >= 2 && !anyCentroidVariation) diagnostics.push({
		code: "BOOTSTRAP_DEGENERATE_DISTRIBUTION",
		severity: "warning",
		message: "All finite bootstrap centroid replicates are identical; percentile intervals cannot express sampling variation."
	});
	if (insufficientReplicates) diagnostics.push({
		code: "BOOTSTRAP_INSUFFICIENT_REPLICATES",
		severity: "warning",
		message: `Intervals with fewer than ${requiredFinite} finite replicates were withheld.`
	});
	return deepFreeze$1({
		schemaVersion: "3dena.trajectory-bootstrap.v1",
		base: context.base,
		confidenceLevel: input.confidenceLevel,
		periods,
		quantileRule: {
			id: "linear-type7-v1",
			sort: "ascending-numeric",
			position: "(n-1)*p",
			interpolation: "linear-between-floor-and-ceiling",
			endpoints: "p=0-min-p=1-max"
		},
		resampling: {
			unit: "participant-complete-history",
			stratified: input.stratifyBy === "explicit",
			strata: context.units.strata.map((stratum) => ({
				key: stratum.key,
				unitCount: stratum.unitIndexes.length
			})),
			replicateCount: repetitions,
			planKind: "participant-history-resample-indices-v1",
			generation: validatedPlan.generation,
			rngParityClaim: false
		},
		diagnostics
	});
}
function deepFreeze$1(value) {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze$1(nested);
		Object.freeze(value);
	}
	return value;
}
//#endregion
//#region packages/analysis/src/trajectory-series-adapters.ts
function reject$1(code, path, message) {
	throw new TrajectoryStatisticsError(code, path, message);
}
function scalarType$1(value, path) {
	if (value === null) reject$1("MISSING_ADAPTER_IDENTITY", path, "trajectory identities must not be null");
	if (typeof value === "string") return "string";
	if (typeof value === "boolean") return "boolean";
	if (!Number.isFinite(value)) reject$1("NON_FINITE_ADAPTER_IDENTITY", path, "numeric trajectory identities must be finite");
	if (Number.isInteger(value) && !Number.isSafeInteger(value)) reject$1("UNSAFE_ADAPTER_IDENTITY", path, "unsafe integer identities must be source strings");
	return "number";
}
function rawEntityIdentity(key, path) {
	if (key.columns.length !== key.values.length) reject$1("ADAPTER_IDENTITY_SHAPE", path, "columns and values must align");
	return { components: key.columns.map((name, index) => {
		const value = key.values[index] ?? null;
		return {
			name,
			type: scalarType$1(value, `${path}.${name}`),
			value
		};
	}) };
}
function preparedEntityIdentity(key, path) {
	if (key.columns.length !== key.values.length || key.columnTypes.length !== key.values.length) reject$1("ADAPTER_IDENTITY_SHAPE", path, "columns, declared types, and values must align");
	return { components: key.columns.map((name, index) => {
		const value = key.values[index] ?? null;
		return {
			name,
			type: scalarType$1(value, `${path}.${name}`),
			value,
			declaredType: key.columnTypes[index]
		};
	}) };
}
function rawTimeIdentity(value) {
	return { components: [{
		name: "time",
		type: scalarType$1(value.value, "time"),
		value: value.value
	}] };
}
function preparedTimeIdentity(value) {
	return { components: [{
		name: value.column,
		type: scalarType$1(value.value, `time.${value.column}`),
		value: value.value,
		declaredType: value.columnType
	}] };
}
function validateOptions(options) {
	if (!options || typeof options.group !== "string" || options.group.length === 0) reject$1("INVALID_ADAPTER_GROUP", "options.group", "must be a canonical group key");
	if (typeof options.namespace !== "string" || options.namespace.trim() === "") reject$1("INVALID_TRAJECTORY_NAMESPACE", "options.namespace", "must be non-empty");
	if (options.participantIdentity !== void 0 && options.participantIdentity !== "unit" && options.participantIdentity !== "participant-label") reject$1("INVALID_PARTICIPANT_IDENTITY", "options.participantIdentity", "must be unit or participant-label");
}
/**
* Copies one already-computed raw-analysis group into the statistics contract.
* Full-space coordinates come from the same jENA fit as the selected axes;
* this adapter never projects or refits the source result.
*/
function adaptAnalysisResultTrajectorySeries(result, options) {
	validateOptions(options);
	const trajectory = result.trajectory;
	if (!trajectory) reject$1("MISSING_SOURCE_TRAJECTORY", "result.trajectory", "must be present before adapting a group path");
	if (!trajectory.groupOrder.some((group) => group.canonical === options.group)) reject$1("UNKNOWN_ADAPTER_GROUP", "options.group", "is not present in the source result");
	const points = result.points.filter((point) => point.group?.canonical === options.group);
	if (points.length === 0) reject$1("EMPTY_ADAPTER_GROUP", "options.group", "contains no source points");
	return {
		namespace: options.namespace,
		dimensions: [...result.dimensions],
		selectedDimensions: [...result.axes],
		timeOrder: trajectory.timeOrder.map(rawTimeIdentity),
		cohortPolicy: trajectory.cohortPolicy,
		points: points.map((point) => {
			if (!point.time) reject$1("MISSING_ADAPTER_TIME", `result.points[${point.index}].time`, "must be present for trajectory statistics");
			return {
				participant: rawEntityIdentity(options.participantIdentity === "participant-label" ? point.participantLabel : point.unit, `result.points[${point.index}].${options.participantIdentity === "participant-label" ? "participantLabel" : "unit"}`),
				time: rawTimeIdentity(point.time),
				coordinates: [...point.fullCoordinates]
			};
		})
	};
}
/** Copies one prepared-space group without projecting, rotating, or refitting coordinates. */
function adaptPreparedSpaceTrajectorySeries(result, options) {
	validateOptions(options);
	const trajectory = result.displaySpace.trajectory;
	if (!trajectory.groupOrder.some((group) => group.canonical === options.group)) reject$1("UNKNOWN_ADAPTER_GROUP", "options.group", "is not present in the prepared result");
	const points = result.fullSpace.points.filter((point) => point.group.canonical === options.group);
	if (points.length === 0) reject$1("EMPTY_ADAPTER_GROUP", "options.group", "contains no prepared points");
	return {
		namespace: options.namespace,
		dimensions: [...result.fullSpace.dimensions],
		selectedDimensions: [...result.displaySpace.dimensions],
		timeOrder: trajectory.timeOrder.map(preparedTimeIdentity),
		cohortPolicy: trajectory.cohortPolicy,
		points: points.map((point) => ({
			participant: preparedEntityIdentity(point.participant, `result.fullSpace.points[${point.index}].participant`),
			time: preparedTimeIdentity(point.time),
			coordinates: [...point.coordinates]
		}))
	};
}
//#endregion
//#region packages/analysis/src/task-executor.ts
init_build_identity();
var SHA256$2 = /^[a-f0-9]{64}$/u;
var ANALYSIS_EXECUTION_DATASET_VERSION_V2 = "3dena.analysis-execution-dataset.v2";
var AnalysisTaskExecutionError = class extends Error {
	code;
	path;
	constructor(code, path, message) {
		super(`${path}: ${message}`);
		this.name = "AnalysisTaskExecutionError";
		this.code = code;
		this.path = path;
	}
};
function reject(code, path, message) {
	throw new AnalysisTaskExecutionError(code, path, message);
}
function canonicalJson$1(value, path = "value") {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) reject("NON_FINITE_HASH_VALUE", path, "cannot be hashed canonically");
		return Object.is(value, -0) ? "-0" : JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map((entry, index) => canonicalJson$1(entry, `${path}[${index}]`)).join(",")}]`;
	if (typeof value !== "object" || value === void 0) reject("UNSUPPORTED_HASH_VALUE", path, "contains an unsupported canonical JSON value");
	const record = value;
	return `{${Object.keys(record).sort().map((key) => {
		if (record[key] === void 0) reject("UNSUPPORTED_HASH_VALUE", `${path}.${key}`, "must not be undefined");
		return `${JSON.stringify(key)}:${canonicalJson$1(record[key], `${path}.${key}`)}`;
	}).join(",")}}`;
}
function hex(bytes) {
	return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
/** SHA-256 over the v1 lexicographically-keyed canonical JSON encoding. */
async function hashAnalysisValueV1(value) {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) reject("CRYPTO_UNAVAILABLE", "crypto.subtle", "WebCrypto SHA-256 is required by Node >=20.9 and supported browsers");
	const bytes = new TextEncoder().encode(canonicalJson$1(value));
	return hex(new Uint8Array(await subtle.digest("SHA-256", bytes)));
}
function exactFields$1(value, allowed, required, path) {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).find((field) => !allowedSet.has(field));
	if (unknown) reject("UNKNOWN_EXECUTION_FIELD", path, `contains unknown field ${JSON.stringify(unknown)}`);
	const missing = required.find((field) => !Object.hasOwn(value, field));
	if (missing) reject("MISSING_EXECUTION_FIELD", path, `is missing required field ${JSON.stringify(missing)}`);
}
/**
* Standalone V2 execution-dataset validator shared by local SDK callers,
* remote compute boundaries, and publication workers. It validates the exact
* source discriminant and complete raw result fields before any task runs.
*/
function assertAnalysisExecutionDatasetV2(value, path = "dataset") {
	if (!value || typeof value !== "object" || Array.isArray(value)) reject("INVALID_EXECUTION_DATASET", path, "must be an object");
	const dataset = value;
	exactFields$1(dataset, [
		"schemaVersion",
		"receipt",
		"specHash",
		"buildId",
		"generatedAt",
		"sourceResult"
	], [
		"schemaVersion",
		"receipt",
		"specHash",
		"buildId"
	], path);
	if (dataset.schemaVersion !== "3dena.analysis-execution-dataset.v2") reject("INVALID_EXECUTION_DATASET", `${path}.schemaVersion`, `must be ${ANALYSIS_EXECUTION_DATASET_VERSION_V2}`);
	assertDatasetReceiptV1(dataset.receipt, `${path}.receipt`);
	if (typeof dataset.specHash !== "string" || !SHA256$2.test(dataset.specHash)) reject("INVALID_SPEC_HASH", `${path}.specHash`, "must be a lowercase SHA-256 digest");
	if (typeof dataset.buildId !== "string" || dataset.buildId.trim() === "") reject("INVALID_BUILD_ID", `${path}.buildId`, "must be non-empty");
	if (dataset.generatedAt !== void 0 && (typeof dataset.generatedAt !== "string" || Number.isNaN(Date.parse(dataset.generatedAt)))) reject("INVALID_GENERATED_AT", `${path}.generatedAt`, "must be an ISO timestamp");
	if (dataset.sourceResult === void 0) return;
	if (!dataset.sourceResult || typeof dataset.sourceResult !== "object" || Array.isArray(dataset.sourceResult)) reject("INVALID_SOURCE_RESULT", `${path}.sourceResult`, "must be an object");
	const source = dataset.sourceResult;
	exactFields$1(source, [
		"sourceKind",
		"hash",
		"result"
	], [
		"sourceKind",
		"hash",
		"result"
	], `${path}.sourceResult`);
	if (typeof source.hash !== "string" || !SHA256$2.test(source.hash)) reject("INVALID_SOURCE_RESULT_HASH", `${path}.sourceResult.hash`, "must be a lowercase SHA-256 digest");
	if (source.sourceKind === "raw-jena") {
		if (!source.result || typeof source.result !== "object" || source.result.schemaVersion !== "3dena.analysis-result.v1") reject("SOURCE_KIND_RESULT_MISMATCH", `${path}.sourceResult.result`, "raw-jena must contain 3dena.analysis-result.v1");
		assertAnalysisTaskResultV1(source.result, "ena-model", `${path}.sourceResult.result`);
		return;
	}
	if (source.sourceKind !== "prepared-exchange") reject("INVALID_SOURCE_KIND", `${path}.sourceResult.sourceKind`, "must be raw-jena or prepared-exchange");
	if (!source.result || typeof source.result !== "object" || source.result.schemaVersion !== "3dena.prepared-space-result.v1") reject("SOURCE_KIND_RESULT_MISMATCH", `${path}.sourceResult.result`, "prepared-exchange must contain 3dena.prepared-space-result.v1");
	assertPreparedDerivedSource(source.result);
	const prepared = source.result;
	const receipt = dataset.receipt;
	if (receipt.format !== "ena3d-json") reject("PREPARED_RECEIPT_FORMAT_MISMATCH", `${path}.receipt.format`, "must be ena3d-json for a prepared-exchange source");
	if (prepared.sourceReceipt.sha256 !== receipt.sha256 || prepared.sourceReceipt.byteLength !== receipt.byteLength) reject("PREPARED_SOURCE_RECEIPT_MISMATCH", `${path}.sourceResult.result.sourceReceipt`, "does not match the activated exact-byte dataset receipt");
}
function validateDataset(dataset, task) {
	if (!dataset || dataset.schemaVersion !== "3dena.analysis-execution-dataset.v1" && dataset.schemaVersion !== "3dena.analysis-execution-dataset.v2") reject("INVALID_EXECUTION_DATASET", "dataset.schemaVersion", "must be 3dena.analysis-execution-dataset.v1 or 3dena.analysis-execution-dataset.v2");
	if (dataset.schemaVersion === "3dena.analysis-execution-dataset.v2") {
		assertAnalysisExecutionDatasetV2(dataset);
		if (task.kind === "ena-model" && dataset.sourceResult?.sourceKind === "prepared-exchange") reject("PREPARED_TASK_UNSUPPORTED", "dataset.sourceResult.sourceKind", "ena-model cannot consume PreparedSpaceResult as though it were raw rows");
	}
	assertDatasetReceiptV1(dataset.receipt, "dataset.receipt");
	if (!SHA256$2.test(dataset.specHash)) reject("INVALID_SPEC_HASH", "dataset.specHash", "must be a lowercase SHA-256 digest");
	if (typeof dataset.buildId !== "string" || dataset.buildId.trim() === "") reject("INVALID_BUILD_ID", "dataset.buildId", "must be non-empty");
	if (dataset.receipt.sha256 !== task.owner.datasetHash) reject("DATASET_OWNER_MISMATCH", "task.owner.datasetHash", "does not match the activated dataset receipt");
	if (dataset.specHash !== task.owner.specHash) reject("SPEC_OWNER_MISMATCH", "task.owner.specHash", "does not match the activated scientific spec");
	if (Date.now() > task.deadlineEpochMilliseconds) reject("TASK_DEADLINE_EXCEEDED", "task.deadlineEpochMilliseconds", "expired before execution began");
	const generatedAt = dataset.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString();
	if (Number.isNaN(Date.parse(generatedAt))) reject("INVALID_GENERATED_AT", "dataset.generatedAt", "must be an ISO timestamp");
	return generatedAt;
}
async function sourceResult(dataset, task) {
	const source = dataset.sourceResult;
	if (!source) reject("MISSING_SOURCE_RESULT", "dataset.sourceResult", `is required for ${task.kind}`);
	let resolved;
	if (dataset.schemaVersion === "3dena.analysis-execution-dataset.v1") {
		if (source.result?.schemaVersion !== "3dena.analysis-result.v1") reject("INVALID_RAW_SOURCE_RESULT", "dataset.sourceResult.result.schemaVersion", "V1 execution datasets accept raw AnalysisResult only");
		resolved = {
			sourceKind: "raw-jena",
			hash: source.hash,
			result: source.result
		};
	} else {
		const sourceV2 = dataset.sourceResult;
		if (!sourceV2) reject("MISSING_SOURCE_RESULT", "dataset.sourceResult", `is required for ${task.kind}`);
		exactFields$1(sourceV2, [
			"sourceKind",
			"hash",
			"result"
		], [
			"sourceKind",
			"hash",
			"result"
		], "dataset.sourceResult");
		if (sourceV2.sourceKind === "raw-jena") {
			if (sourceV2.result?.schemaVersion !== "3dena.analysis-result.v1") reject("SOURCE_KIND_RESULT_MISMATCH", "dataset.sourceResult", "raw-jena must contain 3dena.analysis-result.v1");
			resolved = sourceV2;
		} else if (sourceV2.sourceKind === "prepared-exchange") {
			if (sourceV2.result?.schemaVersion !== "3dena.prepared-space-result.v1") reject("SOURCE_KIND_RESULT_MISMATCH", "dataset.sourceResult", "prepared-exchange must contain 3dena.prepared-space-result.v1");
			resolved = sourceV2;
		} else reject("INVALID_SOURCE_KIND", "dataset.sourceResult.sourceKind", "must be raw-jena or prepared-exchange");
	}
	if (!SHA256$2.test(resolved.hash)) reject("INVALID_SOURCE_RESULT_HASH", "dataset.sourceResult.hash", "must be a lowercase SHA-256 digest");
	if (resolved.hash !== task.sourceResultHash) reject("SOURCE_RESULT_OWNER_MISMATCH", "task.sourceResultHash", "does not match dataset.sourceResult.hash");
	if (await hashAnalysisValueV1(resolved.result) !== resolved.hash) reject("SOURCE_RESULT_HASH_MISMATCH", "dataset.sourceResult", "result bytes do not match the immutable source hash");
	if (resolved.sourceKind === "prepared-exchange") {
		assertPreparedDerivedSource(resolved.result);
		if (dataset.receipt.format !== "ena3d-json") reject("PREPARED_RECEIPT_FORMAT_MISMATCH", "dataset.receipt.format", "must be ena3d-json for a prepared-exchange source");
		if (resolved.result.sourceReceipt.sha256 !== dataset.receipt.sha256 || resolved.result.sourceReceipt.byteLength !== dataset.receipt.byteLength) reject("PREPARED_SOURCE_RECEIPT_MISMATCH", "dataset.sourceResult.result.sourceReceipt", "does not match the activated exact-byte dataset receipt");
	}
	return resolved;
}
function dimensionIndex(result, dimension, path) {
	const index = result.dimensions.indexOf(dimension);
	if (index < 0) reject("UNKNOWN_DIMENSION", path, `is not retained in the source result: ${JSON.stringify(dimension)}`);
	return index;
}
function groupPoints(result, canonical, path) {
	const points = result.points.filter((point) => point.group?.canonical === canonical);
	if (points.length === 0) reject("UNKNOWN_OR_EMPTY_GROUP", path, "does not select any source points");
	return points;
}
function identityComponent(name, value, path) {
	if (value === null) reject("MISSING_PAIRED_IDENTITY", path, "paired identity components must not be null");
	if (typeof value === "number") {
		if (!Number.isFinite(value)) reject("NON_FINITE_PAIRED_IDENTITY", path, "must be finite");
		if (Number.isInteger(value) && !Number.isSafeInteger(value)) reject("UNSAFE_PAIRED_IDENTITY", path, "unsafe integer IDs must be source strings");
		return {
			name,
			type: "number",
			value
		};
	}
	if (typeof value === "boolean") return {
		name,
		type: "boolean",
		value
	};
	return {
		name,
		type: "string",
		value
	};
}
function pointPairIdentity(point) {
	const components = point.participantLabel.columns.map((name, index) => identityComponent(name, point.participantLabel.values[index] ?? null, `points[${point.index}].participantLabel.${name}`));
	if (point.time) components.push(identityComponent("@3dena/time", point.time.value, `points[${point.index}].time`));
	return { components };
}
function executeStatistics(result, task) {
	const sideA = groupPoints(result, task.groups[0], "task.groups[0]");
	const sideB = groupPoints(result, task.groups[1], "task.groups[1]");
	const dimensions = task.dimensions.map((dimension, dimensionPosition) => {
		const index = dimensionIndex(result, dimension, `task.dimensions[${dimensionPosition}]`);
		if (task.design === "independent") return {
			dimension,
			result: analyzeIndependentSamples({
				schemaVersion: "3dena.stats.independent-input.v1",
				sideA: {
					label: task.groups[0],
					values: sideA.map((point) => point.fullCoordinates[index])
				},
				sideB: {
					label: task.groups[1],
					values: sideB.map((point) => point.fullCoordinates[index])
				},
				alternative: task.alternative,
				adjustment: task.adjustment
			})
		};
		return {
			dimension,
			result: analyzePairedSamples({
				schemaVersion: "3dena.stats.paired-input.v1",
				sideA: {
					label: task.groups[0],
					observations: sideA.map((point) => ({
						id: pointPairIdentity(point),
						value: point.fullCoordinates[index]
					}))
				},
				sideB: {
					label: task.groups[1],
					observations: sideB.map((point) => ({
						id: pointPairIdentity(point),
						value: point.fullCoordinates[index]
					}))
				},
				alternative: task.alternative,
				adjustment: task.adjustment
			})
		};
	});
	return {
		schemaVersion: "3dena.statistics-task-result.v1",
		design: task.design,
		direction: "group-a-minus-group-b",
		groups: [...task.groups],
		dimensions
	};
}
function preparedPointPairIdentity(point) {
	return { components: [{
		name: "@3dena/prepared-participant",
		type: "string",
		value: point.participant.canonical
	}, {
		name: "@3dena/prepared-time",
		type: "string",
		value: point.time.canonical
	}] };
}
function executePreparedStatistics(result, task) {
	const sideA = preparedPointsForGroup(result, task.groups[0], "task.groups[0]");
	const sideB = preparedPointsForGroup(result, task.groups[1], "task.groups[1]");
	const dimensions = task.dimensions.map((dimension, dimensionPosition) => {
		const index = preparedDimensionIndex(result, dimension, `task.dimensions[${dimensionPosition}]`);
		if (task.design === "independent") {
			const analyzed = analyzeIndependentSamples({
				schemaVersion: "3dena.stats.independent-input.v1",
				sideA: {
					label: task.groups[0],
					values: sideA.map((point) => point.coordinates[index])
				},
				sideB: {
					label: task.groups[1],
					values: sideB.map((point) => point.coordinates[index])
				},
				alternative: task.alternative,
				adjustment: task.adjustment
			});
			return {
				dimension,
				result: {
					...analyzed,
					diagnostics: [...analyzed.diagnostics, preparedReductionDiagnostic()]
				}
			};
		}
		const analyzed = analyzePairedSamples({
			schemaVersion: "3dena.stats.paired-input.v1",
			sideA: {
				label: task.groups[0],
				observations: sideA.map((point) => ({
					id: preparedPointPairIdentity(point),
					value: point.coordinates[index]
				}))
			},
			sideB: {
				label: task.groups[1],
				observations: sideB.map((point) => ({
					id: preparedPointPairIdentity(point),
					value: point.coordinates[index]
				}))
			},
			alternative: task.alternative,
			adjustment: task.adjustment
		});
		return {
			dimension,
			result: {
				...analyzed,
				diagnostics: [...analyzed.diagnostics, preparedReductionDiagnostic()]
			}
		};
	});
	return {
		schemaVersion: "3dena.statistics-task-result.v1",
		design: task.design,
		direction: "group-a-minus-group-b",
		groups: [...task.groups],
		dimensions
	};
}
function trajectorySeries(result, group, namespace, participantIdentity = "unit") {
	return adaptAnalysisResultTrajectorySeries(result, {
		group,
		namespace,
		participantIdentity
	});
}
function executeTrajectoryDynamics(source, task) {
	const trajectory = source.trajectory;
	if (!trajectory) reject("MISSING_SOURCE_TRAJECTORY", "sourceResult.trajectory", "is required for a trajectory task");
	const series = trajectorySeries(source, task.group, `${task.owner.taskId}:trajectory`);
	if (task.periods.length !== trajectory.timeOrder.length || task.periods.length !== series.timeOrder.length) reject("TRAJECTORY_PERIOD_BINDING_MISMATCH", "task.periods", "must bind every source period exactly once in source order");
	const periods = task.periods.map((period, index) => {
		const sourceTime = trajectory.timeOrder[index];
		const seriesTime = series.timeOrder[index];
		if (!sourceTime || !seriesTime || sourceTime.canonical !== period.sourceTimeCanonical) reject("TRAJECTORY_PERIOD_BINDING_MISMATCH", `task.periods[${index}].sourceTimeCanonical`, "does not match the immutable source trajectory time key at this index");
		return {
			time: seriesTime,
			value: structuredClone(period.value)
		};
	});
	const sourcePoints = groupPoints(source, task.group, "task.group");
	if (sourcePoints.length !== series.points.length) reject("TRAJECTORY_ADAPTER_SHAPE_MISMATCH", "sourceResult.points", "adapter point order does not match the immutable source group");
	const points = series.points.map((point, index) => {
		if (task.estimand.kind === "equal-participant-v1") return { ...point };
		const value = sourcePoints[index].metadata[task.estimand.metadataField];
		if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) reject("INVALID_TRAJECTORY_WEIGHT", `sourceResult.points[${sourcePoints[index].index}].metadata.${task.estimand.metadataField}`, "weighted trajectories require a finite, strictly positive numeric metadata value for every point");
		return {
			...point,
			weight: value
		};
	});
	try {
		return analyzeTrajectoryDynamicsV1({
			schemaVersion: "3dena.trajectory-dynamics-input.v1",
			namespace: series.namespace,
			points,
			dimensions: [...series.dimensions],
			selectedDimensions: [...task.selectedDimensions],
			periods,
			cohortPolicy: task.cohortPolicy,
			estimand: { kind: task.estimand.kind }
		});
	} catch (error) {
		if (error instanceof TrajectoryDynamicsError) reject(error.code, `trajectory.${error.path}`, error.message);
		throw error;
	}
}
function withPreparedDiagnostic(result) {
	return {
		...result,
		diagnostics: [...result.diagnostics, preparedReductionDiagnostic()]
	};
}
function executePreparedTrajectoryDynamics(source, task) {
	const series = adaptPreparedSpaceTrajectorySeries(source, {
		group: task.group,
		namespace: `${task.owner.taskId}:prepared-trajectory`
	});
	task.selectedDimensions.forEach((dimension, index) => preparedDimensionIndex(source, dimension, `task.selectedDimensions[${index}]`));
	const sourceTimeOrder = source.displaySpace.trajectory.timeOrder;
	if (task.periods.length !== sourceTimeOrder.length || task.periods.length !== series.timeOrder.length) reject("TRAJECTORY_PERIOD_BINDING_MISMATCH", "task.periods", "must bind every prepared source period exactly once in source order");
	const periods = task.periods.map((period, index) => {
		const sourceTime = sourceTimeOrder[index];
		const seriesTime = series.timeOrder[index];
		if (!sourceTime || !seriesTime || sourceTime.canonical !== period.sourceTimeCanonical) reject("TRAJECTORY_PERIOD_BINDING_MISMATCH", `task.periods[${index}].sourceTimeCanonical`, "does not match the immutable prepared time key at this index");
		return {
			time: seriesTime,
			value: structuredClone(period.value)
		};
	});
	const sourcePoints = preparedPointsForGroup(source, task.group, "task.group");
	const points = series.points.map((point, index) => {
		if (task.estimand.kind === "equal-participant-v1") return { ...point };
		const weight = sourcePoints[index]?.metadata[task.estimand.metadataField];
		if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) reject("INVALID_TRAJECTORY_WEIGHT", `sourceResult.fullSpace.points[${sourcePoints[index]?.index ?? index}].metadata.${task.estimand.metadataField}`, "weighted prepared trajectories require one finite, strictly positive numeric metadata value per point");
		return {
			...point,
			weight
		};
	});
	try {
		const result = analyzeTrajectoryDynamicsV1({
			schemaVersion: "3dena.trajectory-dynamics-input.v1",
			namespace: series.namespace,
			points,
			dimensions: [...series.dimensions],
			selectedDimensions: [...task.selectedDimensions],
			periods,
			cohortPolicy: task.cohortPolicy,
			estimand: { kind: task.estimand.kind }
		});
		const diagnostics = [...result.diagnostics, preparedReductionDiagnostic()];
		return {
			...result,
			diagnostics,
			diagnosticSummary: {
				info: diagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
				warning: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
				codes: [...new Set(diagnostics.map((diagnostic) => diagnostic.code))]
			}
		};
	} catch (error) {
		if (error instanceof TrajectoryDynamicsError) reject(error.code, `trajectory.${error.path}`, error.message);
		throw error;
	}
}
function diagnosticsFor(result) {
	if (result.schemaVersion === "3dena.analysis-result.v1" || result.schemaVersion === "3dena.prepared-space-result.v1" || result.schemaVersion === "3dena.network-comparison.v1" || result.schemaVersion === "3dena.change-network.v1" || result.schemaVersion === "3dena.trajectory-dynamics.v1" || result.schemaVersion === "3dena.trajectory-path-statistics.v1" || result.schemaVersion === "3dena.trajectory-comparison.v1" || result.schemaVersion === "3dena.trajectory-bootstrap.v1") return result.diagnostics.map((diagnostic) => ({ ...diagnostic }));
	return result.dimensions.flatMap(({ dimension, result: dimensionResult }) => dimensionResult.diagnostics.map((diagnostic) => ({
		...diagnostic,
		path: diagnostic.path ?? `dimensions.${dimension}`
	})));
}
function decodePreparedBase64(value) {
	let binary;
	try {
		binary = globalThis.atob(value);
	} catch {
		reject("INVALID_PREPARED_BASE64", "task.input.exactBytesBase64", "must decode as canonical base64");
	}
	if (globalThis.btoa(binary) !== value) reject("INVALID_PREPARED_BASE64", "task.input.exactBytesBase64", "must use canonical padding and trailing bits");
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
async function executePreparedImport(dataset, task) {
	if (dataset.receipt.format !== "ena3d-json") reject("PREPARED_RECEIPT_FORMAT_MISMATCH", "dataset.receipt.format", "must be ena3d-json for prepared-import");
	const artifact = await decodeEna3dExchangeV1WithSha256(decodePreparedBase64(task.input.exactBytesBase64));
	if (artifact.sha256 !== dataset.receipt.sha256 || artifact.byteLength !== dataset.receipt.byteLength) reject("PREPARED_SOURCE_RECEIPT_MISMATCH", "task.input.exactBytesBase64", "does not match the immutable upload receipt");
	const result = analyzePreparedSpace({
		source: {
			artifact,
			name: task.input.sourceName
		},
		mapping: task.input.mapping
	});
	const dimensions = result.fullSpace.dimensions;
	if (dataset.receipt.rows !== result.fullSpace.points.length || dataset.receipt.columns !== dimensions.length || dataset.receipt.schema.headers.length !== dimensions.length || dataset.receipt.schema.columns.length !== dimensions.length || dimensions.some((dimension, index) => dataset.receipt.schema.headers[index] !== dimension || dataset.receipt.schema.columns[index]?.name !== dimension || dataset.receipt.schema.columns[index]?.inferredType !== "number" || dataset.receipt.schema.columns[index]?.roles.length !== 1 || dataset.receipt.schema.columns[index]?.roles[0] !== "unmapped")) reject("PREPARED_INVENTORY_MISMATCH", "dataset.receipt", "does not match the service-decoded prepared exchange result");
	return result;
}
async function executeTaskResult(dataset, task) {
	switch (task.kind) {
		case "ena-model": {
			const { analyzeRows } = await Promise.resolve().then(() => (init_analyze(), analyze_exports));
			return {
				result: analyzeRows(task.input),
				sourceKind: "raw-jena"
			};
		}
		case "prepared-import": return {
			result: await executePreparedImport(dataset, task),
			sourceKind: "prepared-exchange"
		};
		case "network-comparison": {
			const source = await sourceResult(dataset, task);
			return {
				result: source.sourceKind === "raw-jena" ? compareGroupNetworks(source.result, task.groups) : comparePreparedGroupNetworks(source.result, task.groups),
				sourceKind: source.sourceKind
			};
		}
		case "change-network": {
			const source = await sourceResult(dataset, task);
			const selector = {
				field: task.field,
				level: task.level
			};
			return {
				result: source.sourceKind === "raw-jena" ? analyzeChangeNetwork(source.result, selector) : analyzePreparedChangeNetwork(source.result, selector),
				sourceKind: source.sourceKind
			};
		}
		case "statistics": {
			const source = await sourceResult(dataset, task);
			return {
				result: source.sourceKind === "raw-jena" ? executeStatistics(source.result, task) : executePreparedStatistics(source.result, task),
				sourceKind: source.sourceKind
			};
		}
		case "trajectory": {
			const source = await sourceResult(dataset, task);
			if (source.sourceKind === "prepared-exchange") return {
				result: executePreparedTrajectoryDynamics(source.result, task),
				sourceKind: "prepared-exchange"
			};
			for (const [index, dimension] of task.selectedDimensions.entries()) dimensionIndex(source.result, dimension, `task.selectedDimensions[${index}]`);
			return {
				result: executeTrajectoryDynamics(source.result, task),
				sourceKind: "raw-jena"
			};
		}
		case "trajectory-comparison": {
			const source = await sourceResult(dataset, task);
			const paired = task.design === "paired";
			const sideA = source.sourceKind === "raw-jena" ? trajectorySeries(source.result, task.groups[0], `${task.owner.taskId}:A`, paired ? "participant-label" : "unit") : adaptPreparedSpaceTrajectorySeries(source.result, {
				group: task.groups[0],
				namespace: `${task.owner.taskId}:prepared:A`
			});
			const sideB = source.sourceKind === "raw-jena" ? trajectorySeries(source.result, task.groups[1], `${task.owner.taskId}:B`, paired ? "participant-label" : "unit") : adaptPreparedSpaceTrajectorySeries(source.result, {
				group: task.groups[1],
				namespace: `${task.owner.taskId}:prepared:B`
			});
			if (paired) {
				const pairedId = source.sourceKind === "raw-jena" ? source.result.points.find((point) => point.group?.canonical === task.groups[0])?.participantLabel.columns ?? [] : source.result.fullSpace.points.find((point) => point.group.canonical === task.groups[0])?.participant.columns ?? [];
				if (pairedId.length === 0) reject("MISSING_PAIRED_ID", "sourceResult.points", "does not expose a participant-label identity");
				return {
					result: source.sourceKind === "prepared-exchange" ? withPreparedDiagnostic(compareTrajectoryPaths({
						design: "paired",
						pairedId,
						sideA: {
							label: task.groups[0],
							series: sideA
						},
						sideB: {
							label: task.groups[1],
							series: sideB
						}
					})) : compareTrajectoryPaths({
						design: "paired",
						pairedId,
						sideA: {
							label: task.groups[0],
							series: sideA
						},
						sideB: {
							label: task.groups[1],
							series: sideB
						}
					}),
					sourceKind: source.sourceKind
				};
			}
			const comparison = compareTrajectoryPaths({
				design: "independent",
				sideA: {
					label: task.groups[0],
					series: sideA
				},
				sideB: {
					label: task.groups[1],
					series: sideB
				}
			});
			return {
				result: source.sourceKind === "prepared-exchange" ? withPreparedDiagnostic(comparison) : comparison,
				sourceKind: source.sourceKind
			};
		}
		case "bootstrap": {
			const source = await sourceResult(dataset, task);
			const series = source.sourceKind === "raw-jena" ? trajectorySeries(source.result, task.group, `${task.owner.taskId}:bootstrap`) : adaptPreparedSpaceTrajectorySeries(source.result, {
				group: task.group,
				namespace: `${task.owner.taskId}:prepared-bootstrap`
			});
			const plan = createSeededTrajectoryBootstrapPlan({
				units: getTrajectoryBootstrapUnits({
					series,
					stratifyBy: "none"
				}),
				repetitions: task.replicates,
				seed: task.seed
			});
			const bootstrap = bootstrapTrajectoryPath({
				series,
				stratifyBy: "none",
				confidenceLevel: task.confidenceLevel,
				plan
			});
			return {
				result: source.sourceKind === "prepared-exchange" ? withPreparedDiagnostic(bootstrap) : bootstrap,
				sourceKind: source.sourceKind
			};
		}
	}
}
/**
* Executes one public SDK task locally using the same TypeScript core as the
* compute worker. Remote clients submit the identical task envelope instead.
*/
async function executeAnalysisTask(dataset, task) {
	assertAnalysisTaskV1(task);
	const generatedAt = validateDataset(dataset, task);
	const { result, sourceKind } = await executeTaskResult(dataset, task);
	if (Date.now() > task.deadlineEpochMilliseconds) reject("TASK_DEADLINE_EXCEEDED", "task.deadlineEpochMilliseconds", "expired before result publication");
	assertAnalysisTaskResultV1(result, task.kind);
	const resultHash = await hashAnalysisValueV1(result);
	const sourceSchemaVersion = task.kind === "ena-model" ? null : dataset.sourceResult?.result.schemaVersion ?? null;
	const envelope = {
		schemaVersion: RESULT_ENVELOPE_VERSION_V1,
		owner: { ...task.owner },
		taskKind: task.kind,
		result,
		diagnostics: diagnosticsFor(result),
		evidence: {
			schemaVersion: "3dena.evidence-stamp.v1",
			scope: "feature",
			status: "IMPLEMENTED_UNVERIFIED",
			datasetHash: task.owner.datasetHash,
			specHash: task.owner.specHash,
			buildId: dataset.buildId,
			approvedForParity: false
		},
		provenance: {
			schemaVersion: PROVENANCE_MANIFEST_VERSION_V1,
			datasetHash: task.owner.datasetHash,
			specHash: task.owner.specHash,
			resultHash,
			adapterVersion: ANALYSIS_BUILD_IDENTITY.sdkVersion,
			jenaPackage: "jena-js",
			jenaVersion: ANALYSIS_BUILD_IDENTITY.jenaVersion,
			jenaCommit: ANALYSIS_BUILD_IDENTITY.jenaCommit,
			sourceKind,
			jenaExecuted: sourceKind === "raw-jena",
			sdkPackage: "@3dena/analysis",
			sdkVersion: ANALYSIS_BUILD_IDENTITY.sdkVersion,
			appVersion: "sdk-local",
			contractVersion: ANALYSIS_CONTRACT_VERSION_V1,
			buildId: dataset.buildId,
			seed: task.kind === "bootstrap" ? task.seed : null,
			toleranceContract: null,
			schemaVersions: [.../* @__PURE__ */ new Set([
				task.schemaVersion,
				...sourceSchemaVersion ? [sourceSchemaVersion] : [],
				result.schemaVersion,
				RESULT_ENVELOPE_VERSION_V1
			])],
			generatedAt
		}
	};
	assertAnalysisResultEnvelopeV1(envelope);
	return envelope;
}
//#endregion
//#region packages/analysis/src/longitudinal-v2.ts
var SHA256$1 = /^[a-f0-9]{64}$/u;
var TRAJECTORY_RUN_SPEC_VERSION_V2 = "3dena.trajectory-run-spec.v2";
var LONGITUDINAL_BUNDLE_VERSION_V2 = "3dena.longitudinal-analysis-bundle.v2";
var LongitudinalExecutionErrorV2 = class extends Error {
	code;
	path;
	constructor(code, path, message) {
		super(`${path}: ${message}`);
		this.name = "LongitudinalExecutionErrorV2";
		this.code = code;
		this.path = path;
	}
};
function contractError(path, message) {
	throw new TypeError(`${path}: ${message}`);
}
function objectAt(value, path) {
	if (!value || typeof value !== "object" || Array.isArray(value)) contractError(path, "must be an object");
	return value;
}
function exactFields(value, allowed, required, path) {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).find((field) => !allowedSet.has(field));
	if (unknown) contractError(path, `contains unknown field ${JSON.stringify(unknown)}`);
	const missing = required.find((field) => !Object.hasOwn(value, field));
	if (missing) contractError(path, `is missing required field ${JSON.stringify(missing)}`);
}
function nonEmptyString$1(value, path) {
	if (typeof value !== "string" || value.trim() === "") contractError(path, "must be a non-empty string");
	return value;
}
function stringList(value, path, exactLength) {
	if (!Array.isArray(value) || value.length === 0) contractError(path, "must be a non-empty string array");
	if (exactLength !== void 0 && value.length !== exactLength) contractError(path, `must contain exactly ${exactLength} values`);
	const output = value.map((entry, index) => nonEmptyString$1(entry, `${path}[${index}]`));
	if (new Set(output).size !== output.length) contractError(path, "must contain distinct values");
	return output;
}
function assertIdentity(value, path) {
	const identity = objectAt(value, path);
	exactFields(identity, ["components"], ["components"], path);
	if (!Array.isArray(identity.components) || identity.components.length === 0) contractError(`${path}.components`, "must be a non-empty array");
	const names = /* @__PURE__ */ new Set();
	identity.components.forEach((candidate, index) => {
		const componentPath = `${path}.components[${index}]`;
		const component = objectAt(candidate, componentPath);
		exactFields(component, [
			"name",
			"type",
			"value",
			"declaredType"
		], [
			"name",
			"type",
			"value"
		], componentPath);
		const name = nonEmptyString$1(component.name, `${componentPath}.name`);
		if (names.has(name)) contractError(`${componentPath}.name`, "duplicates an earlier component name");
		names.add(name);
		if (component.type === "string" && typeof component.value === "string") return;
		if (component.type === "boolean" && typeof component.value === "boolean") return;
		if (component.type === "number" && typeof component.value === "number" && Number.isFinite(component.value)) {
			if (Number.isInteger(component.value) && !Number.isSafeInteger(component.value)) contractError(`${componentPath}.value`, "unsafe integer identities must be supplied as strings");
			return;
		}
		contractError(componentPath, "declared identity type must match its finite value");
	});
}
function assertOrderedPeriodValue(value, path) {
	const period = objectAt(value, path);
	const type = nonEmptyString$1(period.type, `${path}.type`);
	if (type === "ordered-index-v2") {
		exactFields(period, ["type", "index"], ["type", "index"], path);
		if (!Number.isSafeInteger(period.index) || period.index < 0) contractError(`${path}.index`, "must be a non-negative safe integer");
		return type;
	}
	if (type === "numeric-v1") {
		exactFields(period, [
			"type",
			"value",
			"unit"
		], [
			"type",
			"value",
			"unit"
		], path);
		if (typeof period.value !== "number" || !Number.isFinite(period.value)) contractError(`${path}.value`, "must be finite");
		nonEmptyString$1(period.unit, `${path}.unit`);
		return type;
	}
	if (type === "date-v1") {
		exactFields(period, ["type", "value"], ["type", "value"], path);
		const date = nonEmptyString$1(period.value, `${path}.value`);
		if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) contractError(`${path}.value`, "must be a valid ISO civil date");
		return type;
	}
	if (type === "instant-v1") {
		exactFields(period, [
			"type",
			"epochMilliseconds",
			"timeZone",
			"offsetMinutes",
			"fold",
			"elapsedUnit"
		], [
			"type",
			"epochMilliseconds",
			"timeZone",
			"offsetMinutes",
			"fold",
			"elapsedUnit"
		], path);
		if (typeof period.epochMilliseconds !== "string" || !/^-?(?:0|[1-9]\d*)$/u.test(period.epochMilliseconds)) contractError(`${path}.epochMilliseconds`, "must be a canonical integer string");
		nonEmptyString$1(period.timeZone, `${path}.timeZone`);
		if (!Number.isInteger(period.offsetMinutes) || period.offsetMinutes < -840 || period.offsetMinutes > 840) contractError(`${path}.offsetMinutes`, "must be an integer in [-840, 840]");
		if (period.fold !== 0 && period.fold !== 1) contractError(`${path}.fold`, "must be 0 or 1");
		nonEmptyString$1(period.elapsedUnit, `${path}.elapsedUnit`);
		return type;
	}
	if (type === "difftime-v1") {
		exactFields(period, [
			"type",
			"value",
			"unit",
			"elapsedUnit"
		], [
			"type",
			"value",
			"unit",
			"elapsedUnit"
		], path);
		if (typeof period.value !== "number" || !Number.isFinite(period.value)) contractError(`${path}.value`, "must be finite");
		nonEmptyString$1(period.unit, `${path}.unit`);
		nonEmptyString$1(period.elapsedUnit, `${path}.elapsedUnit`);
		return type;
	}
	contractError(`${path}.type`, `unsupported ordered-period value ${JSON.stringify(type)}`);
}
function periodCoordinate(value) {
	if (value.type === "ordered-index-v2") return value.index;
	if (value.type === "numeric-v1") return value.value;
	if (value.type === "date-v1") return Date.parse(`${value.value}T00:00:00Z`);
	if (value.type === "instant-v1") return BigInt(value.epochMilliseconds);
	const milliseconds = {
		milliseconds: 1,
		seconds: 1e3,
		minutes: 6e4,
		hours: 36e5,
		days: 864e5,
		weeks: 6048e5
	};
	return value.value * milliseconds[value.unit] / milliseconds[value.elapsedUnit];
}
function assertTrajectoryRunSpecV2(value, path = "runSpec") {
	const spec = objectAt(value, path);
	exactFields(spec, [
		"schemaVersion",
		"sourceResultHash",
		"participantColumns",
		"timeColumn",
		"groupColumn",
		"orderedPeriods",
		"selectedDimensions",
		"cohortPolicy",
		"missingValuePolicy",
		"estimand"
	], [
		"schemaVersion",
		"sourceResultHash",
		"participantColumns",
		"timeColumn",
		"groupColumn",
		"orderedPeriods",
		"selectedDimensions",
		"cohortPolicy",
		"missingValuePolicy",
		"estimand"
	], path);
	if (spec.schemaVersion !== "3dena.trajectory-run-spec.v2") contractError(`${path}.schemaVersion`, `must be ${TRAJECTORY_RUN_SPEC_VERSION_V2}`);
	if (typeof spec.sourceResultHash !== "string" || !SHA256$1.test(spec.sourceResultHash)) contractError(`${path}.sourceResultHash`, "must be a lowercase SHA-256 digest");
	stringList(spec.participantColumns, `${path}.participantColumns`);
	nonEmptyString$1(spec.timeColumn, `${path}.timeColumn`);
	if (spec.groupColumn !== null) nonEmptyString$1(spec.groupColumn, `${path}.groupColumn`);
	const selected = stringList(spec.selectedDimensions, `${path}.selectedDimensions`, 3);
	if (new Set(selected).size !== 3) contractError(`${path}.selectedDimensions`, "must contain three distinct dimensions");
	if (spec.cohortPolicy !== "available" && spec.cohortPolicy !== "complete") contractError(`${path}.cohortPolicy`, "must be available or complete");
	if (spec.missingValuePolicy !== "complete-analytical-rows") contractError(`${path}.missingValuePolicy`, "must be complete-analytical-rows");
	const estimand = objectAt(spec.estimand, `${path}.estimand`);
	if (estimand.kind === "equal-participant") exactFields(estimand, ["kind"], ["kind"], `${path}.estimand`);
	else if (estimand.kind === "weighted-participant") {
		exactFields(estimand, ["kind", "metadataField"], ["kind", "metadataField"], `${path}.estimand`);
		nonEmptyString$1(estimand.metadataField, `${path}.estimand.metadataField`);
	} else contractError(`${path}.estimand.kind`, "must be equal-participant or weighted-participant");
	if (!Array.isArray(spec.orderedPeriods) || spec.orderedPeriods.length === 0) contractError(`${path}.orderedPeriods`, "must be a non-empty array");
	const sourceCanonicals = /* @__PURE__ */ new Set();
	const identityCanonicals = /* @__PURE__ */ new Set();
	let valueType = null;
	let priorCoordinate = null;
	spec.orderedPeriods.forEach((candidate, index) => {
		const periodPath = `${path}.orderedPeriods[${index}]`;
		const period = objectAt(candidate, periodPath);
		exactFields(period, [
			"identity",
			"sourceTimeCanonical",
			"displayLabel",
			"expected",
			"value"
		], [
			"identity",
			"sourceTimeCanonical",
			"displayLabel",
			"expected",
			"value"
		], periodPath);
		assertIdentity(period.identity, `${periodPath}.identity`);
		const canonicalIdentity = JSON.stringify(period.identity);
		if (identityCanonicals.has(canonicalIdentity)) contractError(`${periodPath}.identity`, "duplicates an earlier typed identity");
		identityCanonicals.add(canonicalIdentity);
		const sourceCanonical = nonEmptyString$1(period.sourceTimeCanonical, `${periodPath}.sourceTimeCanonical`);
		if (sourceCanonicals.has(sourceCanonical)) contractError(`${periodPath}.sourceTimeCanonical`, "duplicates an earlier source identity");
		sourceCanonicals.add(sourceCanonical);
		nonEmptyString$1(period.displayLabel, `${periodPath}.displayLabel`);
		if (typeof period.expected !== "boolean") contractError(`${periodPath}.expected`, "must be boolean");
		const currentType = assertOrderedPeriodValue(period.value, `${periodPath}.value`);
		if (valueType !== null && currentType !== valueType) contractError(`${periodPath}.value.type`, `must use ${valueType} for every ordered period`);
		valueType = currentType;
		const coordinate = periodCoordinate(period.value);
		if (priorCoordinate !== null) {
			if (!(typeof coordinate === "bigint" && typeof priorCoordinate === "bigint" ? coordinate > priorCoordinate : typeof coordinate === "number" && typeof priorCoordinate === "number" && coordinate > priorCoordinate)) contractError(`${periodPath}.value`, "period values must be strictly increasing");
		}
		priorCoordinate = coordinate;
	});
}
function deepFreeze(value) {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
function executionReject(code, path, message) {
	throw new LongitudinalExecutionErrorV2(code, path, message);
}
function assertPathTaskV2(task, path = "pathTask") {
	const record = objectAt(task, path);
	exactFields(record, [
		"schemaVersion",
		"kind",
		"datasetHash",
		"specHash",
		"runId",
		"runSpec"
	], [
		"schemaVersion",
		"kind",
		"datasetHash",
		"specHash",
		"runId",
		"runSpec"
	], path);
	if (record.schemaVersion !== "3dena.trajectory-path-task.v2") contractError(`${path}.schemaVersion`, "must be 3dena.trajectory-path-task.v2");
	if (record.kind !== "trajectory-path-v2") contractError(`${path}.kind`, "must be trajectory-path-v2");
	for (const field of ["datasetHash", "specHash"]) if (typeof record[field] !== "string" || !SHA256$1.test(record[field])) contractError(`${path}.${field}`, "must be a lowercase SHA-256 digest");
	nonEmptyString$1(record.runId, `${path}.runId`);
	assertTrajectoryRunSpecV2(record.runSpec, `${path}.runSpec`);
}
function scalarType(value, path) {
	if (value === null) executionReject("MISSING_TRAJECTORY_IDENTITY", path, "must not be null");
	if (typeof value === "string") return "string";
	if (typeof value === "boolean") return "boolean";
	if (!Number.isFinite(value)) executionReject("NON_FINITE_TRAJECTORY_IDENTITY", path, "must be finite");
	if (Number.isInteger(value) && !Number.isSafeInteger(value)) executionReject("UNSAFE_TRAJECTORY_IDENTITY", path, "unsafe integer identities must be source strings");
	return "number";
}
function rawGroupIdentity(value, column) {
	return { components: [{
		name: column ?? "@3dena/group",
		type: scalarType(value, "sourceResult.trajectory.group"),
		value
	}] };
}
function toTrajectoryTimeValueV1(value) {
	if (value.type === "ordered-index-v2") return {
		type: "numeric-v1",
		value: value.index,
		unit: "ordered-period"
	};
	return structuredClone(value);
}
function validateExecutionMetadata(input) {
	if (![
		"browser-worker",
		"persistent-compute-service",
		"node-service"
	].includes(input.target)) executionReject("INVALID_EXECUTION_TARGET", "execution.target", "is unsupported");
	for (const field of [
		"jenaVersion",
		"jenaCommit",
		"jenaTarballIntegrity",
		"sdkVersion",
		"buildId"
	]) if (typeof input[field] !== "string" || input[field].trim() === "") executionReject("INVALID_BUILD_METADATA", `execution.${field}`, "must be non-empty");
	if (!Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 4294967295) executionReject("INVALID_EXECUTION_SEED", "execution.seed", "must be a uint32 safe integer");
}
/**
* Strict, side-effect-free boundary validation for browser, HTTP and durable
* worker callers. Scientific source-hash verification remains asynchronous and
* is performed by `executeLongitudinalAnalysisV2` before any result is emitted.
*/
function assertLongitudinalExecutionRequestV2(value, path = "input") {
	const request = objectAt(value, path);
	exactFields(request, [
		"dataset",
		"pathTask",
		"inferenceTask",
		"bootstrapTask",
		"networkOverlayTask",
		"execution"
	], [
		"dataset",
		"pathTask",
		"execution"
	], path);
	assertAnalysisExecutionDatasetV2(request.dataset, `${path}.dataset`);
	assertPathTaskV2(request.pathTask, `${path}.pathTask`);
	const pathTask = request.pathTask;
	if (Object.hasOwn(request, "inferenceTask")) assertInferenceTaskV2(request.inferenceTask, pathTask);
	if (Object.hasOwn(request, "bootstrapTask")) assertBootstrapTaskV2(request.bootstrapTask, pathTask);
	if (Object.hasOwn(request, "networkOverlayTask")) assertNetworkOverlayTaskV2(request.networkOverlayTask, pathTask);
	const execution = objectAt(request.execution, `${path}.execution`);
	exactFields(execution, [
		"target",
		"jenaVersion",
		"jenaCommit",
		"jenaTarballIntegrity",
		"sdkVersion",
		"buildId",
		"seed"
	], [
		"target",
		"jenaVersion",
		"jenaCommit",
		"jenaTarballIntegrity",
		"sdkVersion",
		"buildId",
		"seed"
	], `${path}.execution`);
	validateExecutionMetadata(execution);
	const executionSeed = execution.seed;
	if (request.inferenceTask !== void 0) request.inferenceTask.requests.forEach((candidate, index) => {
		if (candidate.kind === "path-comparison" && candidate.seed !== executionSeed) contractError(`${path}.inferenceTask.requests[${index}].seed`, "must equal execution.seed");
	});
	if (request.bootstrapTask !== void 0 && request.bootstrapTask.seed !== executionSeed) contractError(`${path}.bootstrapTask.seed`, "must equal execution.seed");
}
function longitudinalExecutionRequestBindingCoreV2(request) {
	const { target: _transportTarget, ...scientificExecution } = request.execution;
	return {
		dataset: request.dataset,
		pathTask: request.pathTask,
		...request.inferenceTask === void 0 ? {} : { inferenceTask: request.inferenceTask },
		...request.bootstrapTask === void 0 ? {} : { bootstrapTask: request.bootstrapTask },
		...request.networkOverlayTask === void 0 ? {} : { networkOverlayTask: request.networkOverlayTask },
		execution: scientificExecution
	};
}
/**
* Canonical binding for every scientific input field. The transport target is
* deliberately excluded because the server owns it and it cannot change the
* scientific task; build metadata, tasks, seeds and repetition plans remain
* bound.
*/
async function hashLongitudinalExecutionRequestV2(request) {
	assertLongitudinalExecutionRequestV2(request);
	return hashAnalysisValueV1(longitudinalExecutionRequestBindingCoreV2(request));
}
function validateMappingBinding(point, runSpec) {
	if (JSON.stringify(point.participantLabel.columns) !== JSON.stringify(runSpec.participantColumns)) executionReject("TRAJECTORY_PARTICIPANT_MAPPING_MISMATCH", "pathTask.runSpec.participantColumns", "does not match the immutable fitted participant identity columns");
	if (runSpec.groupColumn !== null && !point.unit.columns.includes(runSpec.groupColumn)) executionReject("TRAJECTORY_GROUP_MAPPING_MISMATCH", "pathTask.runSpec.groupColumn", "is absent from the immutable fitted unit mapping");
	if (!point.id.columns.includes(runSpec.timeColumn) || point.unit.columns.includes(runSpec.timeColumn)) executionReject("TRAJECTORY_TIME_MAPPING_MISMATCH", "pathTask.runSpec.timeColumn", "does not match the immutable fitted time/conversation mapping");
}
function sourcePointsForGroup(points, groupCanonical) {
	return points.filter((point) => point.group?.canonical === groupCanonical);
}
function buildGroupInputsV2(source, runSpec) {
	const result = source.result;
	const trajectory = result.trajectory;
	if (!trajectory) executionReject("MISSING_SOURCE_TRAJECTORY", "dataset.sourceResult.result.trajectory", "is required for a longitudinal task");
	const model = result.provenance.resolvedConfig.model;
	if (model !== "SeparateTrajectory" && model !== "AccumulatedTrajectory") executionReject("UNSUPPORTED_LONGITUDINAL_MODEL", "dataset.sourceResult.result.provenance.resolvedConfig.model", "must be SeparateTrajectory or AccumulatedTrajectory");
	if (result.points.length === 0) executionReject("EMPTY_SOURCE_RESULT", "dataset.sourceResult.result.points", "must contain fitted points");
	validateMappingBinding(result.points[0], runSpec);
	for (const [index, dimension] of runSpec.selectedDimensions.entries()) if (!result.dimensions.includes(dimension)) executionReject("UNKNOWN_SELECTED_DIMENSION", `pathTask.runSpec.selectedDimensions[${index}]`, "is absent from the fitted full rotation");
	if (result.dimensions.length < 3) executionReject("INSUFFICIENT_LONGITUDINAL_DIMENSIONS", "dataset.sourceResult.result.dimensions", "3D trajectory requires at least three fitted dimensions");
	const sourceTimes = trajectory.timeOrder;
	if (model === "AccumulatedTrajectory") {
		const fittedTimes = new Set(sourceTimes.map((time) => time.canonical));
		const requestedObserved = runSpec.orderedPeriods.map((period) => period.sourceTimeCanonical).filter((canonical) => fittedTimes.has(canonical));
		const requestedSet = new Set(requestedObserved);
		const fittedObserved = sourceTimes.map((time) => time.canonical).filter((canonical) => requestedSet.has(canonical));
		if (JSON.stringify(requestedObserved) !== JSON.stringify(fittedObserved)) executionReject("ACCUMULATED_TRAJECTORY_ORDER_MISMATCH", "pathTask.runSpec.orderedPeriods", "must preserve the immutable fitted chronology because later accumulated points contain earlier history");
	}
	const firstGroup = trajectory.groupOrder[0];
	if (!firstGroup) executionReject("EMPTY_TRAJECTORY_GROUPS", "dataset.sourceResult.result.trajectory.groupOrder", "must contain at least one group");
	const firstSeries = adaptAnalysisResultTrajectorySeries(result, {
		group: firstGroup.canonical,
		namespace: `${runSpec.sourceResultHash}:period-binding`,
		participantIdentity: "participant-label"
	});
	const periods = runSpec.orderedPeriods.map((period, index) => {
		const observedIndex = sourceTimes.findIndex((sourceTime) => sourceTime.canonical === period.sourceTimeCanonical);
		if (observedIndex >= 0) {
			const time = firstSeries.timeOrder[observedIndex];
			if (!time) executionReject("TRAJECTORY_PERIOD_BINDING_MISMATCH", `pathTask.runSpec.orderedPeriods[${index}]`, "does not align with the fitted trajectory time order");
			return {
				time,
				value: toTrajectoryTimeValueV1(period.value)
			};
		}
		return {
			time: structuredClone(period.identity),
			value: toTrajectoryTimeValueV1(period.value)
		};
	});
	return {
		groups: trajectory.groupOrder.map((group, groupIndex) => {
			const series = adaptAnalysisResultTrajectorySeries(result, {
				group: group.canonical,
				namespace: `longitudinal-v2:${runSpec.sourceResultHash}:group:${groupIndex}`,
				participantIdentity: "participant-label"
			});
			const rawPoints = sourcePointsForGroup(result.points, group.canonical);
			if (rawPoints.length !== series.points.length) executionReject("TRAJECTORY_ADAPTER_SHAPE_MISMATCH", `dataset.sourceResult.result.trajectory.groupOrder[${groupIndex}]`, "adapter point order does not match fitted source points");
			const points = series.points.map((point, pointIndex) => {
				if (runSpec.estimand.kind === "equal-participant") return {
					...point,
					coordinates: [...point.coordinates]
				};
				const weight = rawPoints[pointIndex].metadata[runSpec.estimand.metadataField];
				if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) executionReject("INVALID_TRAJECTORY_WEIGHT", `dataset.sourceResult.result.points[${rawPoints[pointIndex].index}].metadata.${runSpec.estimand.metadataField}`, "must be finite and strictly positive for every point");
				return {
					...point,
					coordinates: [...point.coordinates],
					weight
				};
			});
			return {
				group: rawGroupIdentity(group.value, runSpec.groupColumn),
				namespace: series.namespace,
				points
			};
		}),
		sourcePoints: trajectory.groupOrder.map((group) => sourcePointsForGroup(result.points, group.canonical)),
		sourceGroups: trajectory.groupOrder.map((group) => ({
			canonical: group.canonical,
			display: group.display
		})),
		periods,
		fullDimensions: [...result.dimensions],
		model
	};
}
function groupContextsV2(built, paths) {
	return paths.map((path, index) => ({
		group: path.group,
		dynamics: path.dynamics,
		series: {
			namespace: built.groups[index].namespace,
			dimensions: [...built.fullDimensions],
			selectedDimensions: [...path.dynamics.selectedDimensions],
			timeOrder: built.periods.map((period) => structuredClone(period.time)),
			cohortPolicy: path.dynamics.cohortPolicy,
			estimand: path.dynamics.estimand.kind === "weighted-participant-v1" ? "weighted-participant" : "equal-participant",
			points: built.groups[index].points.map((point) => ({
				participant: structuredClone(point.participant),
				time: structuredClone(point.time),
				coordinates: [...point.coordinates],
				...point.weight === void 0 ? {} : { weight: point.weight }
			}))
		},
		sourcePoints: built.sourcePoints[index].map((point) => structuredClone(point))
	}));
}
function assertDerivedTaskBinding(task, pathTask, path) {
	if (task.datasetHash !== pathTask.datasetHash) executionReject("TRAJECTORY_DATASET_BINDING_MISMATCH", `${path}.datasetHash`, "does not match the path task");
	if (task.specHash !== pathTask.specHash) executionReject("TRAJECTORY_SPEC_BINDING_MISMATCH", `${path}.specHash`, "does not match the path task");
	if (task.sourceResultHash !== pathTask.runSpec.sourceResultHash) executionReject("TRAJECTORY_SOURCE_BINDING_MISMATCH", `${path}.sourceResultHash`, "does not match the path task");
	if (task.runId !== pathTask.runId) executionReject("TRAJECTORY_RUN_BINDING_MISMATCH", `${path}.runId`, "does not match the path task");
}
function assertInferenceTaskV2(task, pathTask) {
	const record = objectAt(task, "inferenceTask");
	exactFields(record, [
		"schemaVersion",
		"kind",
		"datasetHash",
		"specHash",
		"sourceResultHash",
		"runId",
		"requests",
		"adjustment"
	], [
		"schemaVersion",
		"kind",
		"datasetHash",
		"specHash",
		"sourceResultHash",
		"runId",
		"requests",
		"adjustment"
	], "inferenceTask");
	if (record.schemaVersion !== "3dena.trajectory-inference-task.v2" || record.kind !== "trajectory-inference-v2") contractError("inferenceTask", "must use the V2 inference task contract");
	if (record.adjustment !== "holm") contractError("inferenceTask.adjustment", "must be holm");
	for (const field of [
		"datasetHash",
		"specHash",
		"sourceResultHash"
	]) if (typeof record[field] !== "string" || !SHA256$1.test(record[field])) contractError(`inferenceTask.${field}`, "must be a lowercase SHA-256 digest");
	nonEmptyString$1(record.runId, "inferenceTask.runId");
	if (!Array.isArray(record.requests) || record.requests.length === 0) contractError("inferenceTask.requests", "must be a non-empty array");
	record.requests.forEach((candidate, index) => {
		const path = `inferenceTask.requests[${index}]`;
		const request = objectAt(candidate, path);
		if (request.kind === "independent-period") {
			exactFields(request, [
				"kind",
				"groups",
				"periodCanonical"
			], [
				"kind",
				"groups",
				"periodCanonical"
			], path);
			stringList(request.groups, `${path}.groups`, 2);
			nonEmptyString$1(request.periodCanonical, `${path}.periodCanonical`);
			return;
		}
		if (request.kind === "paired-periods") {
			exactFields(request, [
				"kind",
				"group",
				"earlierPeriodCanonical",
				"laterPeriodCanonical",
				"samePhysicalEntityConfirmed"
			], [
				"kind",
				"group",
				"earlierPeriodCanonical",
				"laterPeriodCanonical",
				"samePhysicalEntityConfirmed"
			], path);
			if (request.group !== null) nonEmptyString$1(request.group, `${path}.group`);
			if (nonEmptyString$1(request.earlierPeriodCanonical, `${path}.earlierPeriodCanonical`) === nonEmptyString$1(request.laterPeriodCanonical, `${path}.laterPeriodCanonical`)) contractError(path, "paired periods must differ");
			if (typeof request.samePhysicalEntityConfirmed !== "boolean") contractError(`${path}.samePhysicalEntityConfirmed`, "must be boolean");
			return;
		}
		if (request.kind === "repeated-periods") {
			exactFields(request, [
				"kind",
				"group",
				"periodCanonicals",
				"samePhysicalEntityConfirmed"
			], [
				"kind",
				"group",
				"periodCanonicals",
				"samePhysicalEntityConfirmed"
			], path);
			if (request.group !== null) nonEmptyString$1(request.group, `${path}.group`);
			stringList(request.periodCanonicals, `${path}.periodCanonicals`);
			if (request.periodCanonicals.length < 3) contractError(`${path}.periodCanonicals`, "must contain at least three periods");
			if (typeof request.samePhysicalEntityConfirmed !== "boolean") contractError(`${path}.samePhysicalEntityConfirmed`, "must be boolean");
			return;
		}
		if (request.kind === "path-comparison") {
			exactFields(request, [
				"kind",
				"design",
				"groups",
				"repetitions",
				"seed",
				"samePhysicalEntityConfirmed"
			], [
				"kind",
				"design",
				"groups",
				"repetitions",
				"seed",
				"samePhysicalEntityConfirmed"
			], path);
			if (request.design !== "independent" && request.design !== "paired") contractError(`${path}.design`, "must be independent or paired");
			stringList(request.groups, `${path}.groups`, 2);
			if (!Number.isSafeInteger(request.repetitions) || request.repetitions < 1 || request.repetitions > 1e4) contractError(`${path}.repetitions`, "must be an integer in [1, 10000]");
			if (!Number.isSafeInteger(request.seed) || request.seed < 0 || request.seed > 4294967295) contractError(`${path}.seed`, "must be a uint32 integer");
			if (typeof request.samePhysicalEntityConfirmed !== "boolean") contractError(`${path}.samePhysicalEntityConfirmed`, "must be boolean");
			if (request.design === "independent" && request.samePhysicalEntityConfirmed !== false) contractError(`${path}.samePhysicalEntityConfirmed`, "must be false for independent comparison");
			return;
		}
		contractError(`${path}.kind`, "is unsupported");
	});
	assertDerivedTaskBinding(record, pathTask, "inferenceTask");
}
function assertBootstrapTaskV2(task, pathTask) {
	const record = objectAt(task, "bootstrapTask");
	exactFields(record, [
		"schemaVersion",
		"kind",
		"datasetHash",
		"specHash",
		"sourceResultHash",
		"runId",
		"repetitions",
		"confidenceLevel",
		"seed",
		"resamplingDesign",
		"explicitStrataField",
		"interval",
		"rotationPolicy"
	], [
		"schemaVersion",
		"kind",
		"datasetHash",
		"specHash",
		"sourceResultHash",
		"runId",
		"repetitions",
		"confidenceLevel",
		"seed",
		"resamplingDesign",
		"explicitStrataField",
		"interval",
		"rotationPolicy"
	], "bootstrapTask");
	if (record.schemaVersion !== "3dena.trajectory-bootstrap-task.v2" || record.kind !== "trajectory-bootstrap-v2") contractError("bootstrapTask", "must use the V2 bootstrap task contract");
	for (const field of [
		"datasetHash",
		"specHash",
		"sourceResultHash"
	]) if (typeof record[field] !== "string" || !SHA256$1.test(record[field])) contractError(`bootstrapTask.${field}`, "must be a lowercase SHA-256 digest");
	nonEmptyString$1(record.runId, "bootstrapTask.runId");
	if (!Number.isSafeInteger(record.repetitions) || record.repetitions < 1 || record.repetitions > 1e4) contractError("bootstrapTask.repetitions", "must be an integer in [1, 10000]");
	if (typeof record.confidenceLevel !== "number" || !Number.isFinite(record.confidenceLevel) || record.confidenceLevel <= 0 || record.confidenceLevel >= 1) contractError("bootstrapTask.confidenceLevel", "must be finite and in (0,1)");
	if (!Number.isSafeInteger(record.seed) || record.seed < 0 || record.seed > 4294967295) contractError("bootstrapTask.seed", "must be a uint32 integer");
	if (![
		"auto",
		"global-participant",
		"within-group",
		"explicit-strata"
	].includes(String(record.resamplingDesign))) contractError("bootstrapTask.resamplingDesign", "is unsupported");
	if (record.resamplingDesign === "explicit-strata") nonEmptyString$1(record.explicitStrataField, "bootstrapTask.explicitStrataField");
	else if (record.explicitStrataField !== null) contractError("bootstrapTask.explicitStrataField", "must be null unless explicit-strata is selected");
	if (record.interval !== "pointwise-percentile-linear-type7") contractError("bootstrapTask.interval", "must be pointwise-percentile-linear-type7");
	if (record.rotationPolicy !== "fixed-same-fit-projection") contractError("bootstrapTask.rotationPolicy", "must be fixed-same-fit-projection");
	assertDerivedTaskBinding(record, pathTask, "bootstrapTask");
}
function assertNetworkOverlayTaskV2(task, pathTask) {
	const record = objectAt(task, "networkOverlayTask");
	exactFields(record, [
		"schemaVersion",
		"kind",
		"datasetHash",
		"specHash",
		"sourceResultHash",
		"runId",
		"requests"
	], [
		"schemaVersion",
		"kind",
		"datasetHash",
		"specHash",
		"sourceResultHash",
		"runId",
		"requests"
	], "networkOverlayTask");
	if (record.schemaVersion !== "3dena.trajectory-network-overlay-task.v2" || record.kind !== "trajectory-network-overlay-v2") contractError("networkOverlayTask", "must use the V2 network-overlay task contract");
	for (const field of [
		"datasetHash",
		"specHash",
		"sourceResultHash"
	]) if (typeof record[field] !== "string" || !SHA256$1.test(record[field])) contractError(`networkOverlayTask.${field}`, "must be a lowercase SHA-256 digest");
	nonEmptyString$1(record.runId, "networkOverlayTask.runId");
	if (!Array.isArray(record.requests) || record.requests.length === 0) contractError("networkOverlayTask.requests", "must be a non-empty array");
	const unique = /* @__PURE__ */ new Set();
	record.requests.forEach((candidate, index) => {
		const path = `networkOverlayTask.requests[${index}]`;
		const request = objectAt(candidate, path);
		exactFields(request, ["periodCanonical", "groupCanonical"], ["periodCanonical", "groupCanonical"], path);
		const period = nonEmptyString$1(request.periodCanonical, `${path}.periodCanonical`);
		const group = request.groupCanonical === null ? null : nonEmptyString$1(request.groupCanonical, `${path}.groupCanonical`);
		const key = JSON.stringify([period, group]);
		if (unique.has(key)) contractError(path, "duplicates an earlier overlay request");
		unique.add(key);
	});
	assertDerivedTaskBinding(record, pathTask, "networkOverlayTask");
}
function resolvePeriodIndex(runSpec, canonical, path) {
	const index = runSpec.orderedPeriods.findIndex((period) => period.sourceTimeCanonical === canonical);
	if (index < 0) executionReject("UNKNOWN_TRAJECTORY_PERIOD", path, "is absent from the ordered-period contract");
	return index;
}
function selectContexts(contexts, canonical, path) {
	if (canonical === null) return contexts;
	const selected = contexts.find((context) => context.group.canonical === canonical);
	if (!selected) executionReject("UNKNOWN_TRAJECTORY_GROUP", path, "is absent from the computed path set");
	return [selected];
}
function participantRowsAtPeriod(context, periodIndex) {
	const period = context.dynamics.periods[periodIndex];
	if (!period) executionReject("UNKNOWN_TRAJECTORY_PERIOD", `paths.${context.group.canonical}.periods[${periodIndex}]`, "is absent");
	return context.dynamics.participantPeriods.filter((row) => row.includedInCohort && row.time.canonical === period.time.canonical);
}
function selectedCoordinateAt(coordinates, axisIndex, path) {
	const value = coordinates[axisIndex];
	if (value === void 0 || !Number.isFinite(value)) executionReject("INVALID_SELECTED_COORDINATE", path, "must resolve to a finite selected-axis coordinate");
	return value;
}
function withHolmRows(rows, familyId) {
	const adjusted = holmAdjustFamilyV2(rows.map(({ memberId, pRaw }) => ({
		memberId,
		pRaw
	})));
	return rows.map((row, index) => ({
		...row,
		familyId,
		familySize: adjusted[index].familySizePlanned,
		pHolm: adjusted[index].pHolm,
		holmRank: adjusted[index].holmRank,
		holmMultiplier: adjusted[index].holmMultiplier
	}));
}
function independentPeriodInference(request, contexts, runSpec) {
	const [groupA, groupB] = request.groups.map((group, index) => selectContexts(contexts, group, `request.groups[${index}]`)[0]);
	const periodIndex = resolvePeriodIndex(runSpec, request.periodCanonical, "request.periodCanonical");
	const rows = runSpec.selectedDimensions.map((axis, axisIndex) => {
		const result = mannWhitneyRankTestV2(participantRowsAtPeriod(groupA, periodIndex).map((row, rowIndex) => selectedCoordinateAt(row.selectedCoordinates, axisIndex, `groupA[${rowIndex}].selectedCoordinates[${axisIndex}]`)), participantRowsAtPeriod(groupB, periodIndex).map((row, rowIndex) => selectedCoordinateAt(row.selectedCoordinates, axisIndex, `groupB[${rowIndex}].selectedCoordinates[${axisIndex}]`)));
		return {
			memberId: `axis:${axis}`,
			test: "mann-whitney",
			design: "independent",
			estimand: "participant-period-coordinate-distribution",
			axis,
			axisIndex,
			periodCanonical: request.periodCanonical,
			status: result.status,
			reason: result.reason,
			nPrimary: result.nPrimary,
			nSecondary: result.nSecondary,
			effect: result.rankBiserialPrimaryVsSecondary,
			statistic: result.uPrimary,
			pRaw: result.pValueTwoSided,
			method: result.resolvedPMethod,
			ties: {
				groups: result.tieGroupCount,
				observations: result.tiedObservationCount,
				correctionSum: result.tieCorrectionSum
			},
			zeros: null,
			exactTail: result.exactTail
		};
	});
	const familyId = `independent-period:${request.periodCanonical}:${request.groups.join(":")}`;
	return {
		request: structuredClone(request),
		status: rows.some((row) => row.status === "available") ? "available" : "not-estimable",
		familyId,
		familySize: rows.length,
		rows: withHolmRows(rows, familyId),
		reason: rows.some((row) => row.status === "available") ? null : "no-estimable-axis"
	};
}
function entityPeriodMaps(contexts, periodIndexes) {
	const output = /* @__PURE__ */ new Map();
	for (const context of contexts) for (const periodIndex of periodIndexes) for (const row of participantRowsAtPeriod(context, periodIndex)) {
		const entity = JSON.stringify([context.group.canonical, row.participant.canonical]);
		const periods = output.get(entity) ?? /* @__PURE__ */ new Map();
		if (periods.has(periodIndex)) executionReject("ENTITY_PERIOD_INSTABILITY", "paths.participantPeriods", "contains a duplicate reduced participant-period");
		periods.set(periodIndex, [...row.selectedCoordinates]);
		output.set(entity, periods);
	}
	return output;
}
function disabledInference(request) {
	return {
		request: structuredClone(request),
		status: "disabled",
		familyId: `${request.kind}:disabled`,
		familySize: 0,
		rows: [],
		reason: "same-physical-entity-not-confirmed"
	};
}
function pairedPeriodInference(request, contexts, runSpec) {
	if (!request.samePhysicalEntityConfirmed) return disabledInference(request);
	const selected = selectContexts(contexts, request.group, "request.group");
	const earlier = resolvePeriodIndex(runSpec, request.earlierPeriodCanonical, "request.earlierPeriodCanonical");
	const later = resolvePeriodIndex(runSpec, request.laterPeriodCanonical, "request.laterPeriodCanonical");
	const maps = entityPeriodMaps(selected, [earlier, later]);
	const earlierCount = [...maps.values()].filter((periods) => periods.has(earlier)).length;
	const laterCount = [...maps.values()].filter((periods) => periods.has(later)).length;
	const complete = [...maps.values()].filter((periods) => periods.has(earlier) && periods.has(later));
	const audit = {
		earlier: earlierCount,
		later: laterCount,
		overlap: complete.length,
		earlierOnly: earlierCount - complete.length,
		laterOnly: laterCount - complete.length,
		samePhysicalEntityConfirmed: true
	};
	const rows = runSpec.selectedDimensions.map((axis, axisIndex) => {
		const result = wilcoxonSignedRankTestV2(complete.map((periods, participantIndex) => selectedCoordinateAt(periods.get(later), axisIndex, `paired[${participantIndex}].later[${axisIndex}]`) - selectedCoordinateAt(periods.get(earlier), axisIndex, `paired[${participantIndex}].earlier[${axisIndex}]`)), { missingPairs: maps.size - complete.length });
		return {
			memberId: `axis:${axis}`,
			test: "wilcoxon-signed-rank",
			design: "paired",
			estimand: "later-minus-earlier-participant-coordinate",
			axis,
			axisIndex,
			earlierPeriodCanonical: request.earlierPeriodCanonical,
			laterPeriodCanonical: request.laterPeriodCanonical,
			status: result.status,
			reason: result.reason,
			n: result.nRanked,
			effect: result.rankBiserialLaterVsEarlier,
			statistic: result.t,
			pRaw: result.pValueTwoSided,
			method: result.resolvedPMethod,
			ties: {
				groups: result.tieGroupCount,
				observations: result.tiedObservationCount,
				correctionSum: result.tieCorrectionSum
			},
			zeros: result.nZero,
			exactTail: result.exactTail,
			identityOverlapAudit: audit
		};
	});
	const familyId = `paired-periods:${request.group ?? "all"}:${request.earlierPeriodCanonical}:${request.laterPeriodCanonical}`;
	return {
		request: structuredClone(request),
		status: rows.some((row) => row.status === "available") ? "available" : "not-estimable",
		familyId,
		familySize: rows.length,
		rows: withHolmRows(rows, familyId),
		reason: rows.some((row) => row.status === "available") ? null : "no-estimable-axis"
	};
}
function repeatedPeriodInference(request, contexts, runSpec) {
	if (!request.samePhysicalEntityConfirmed) return disabledInference(request);
	const selected = selectContexts(contexts, request.group, "request.group");
	const periodIndexes = request.periodCanonicals.map((canonical, index) => resolvePeriodIndex(runSpec, canonical, `request.periodCanonicals[${index}]`));
	const maps = entityPeriodMaps(selected, periodIndexes);
	const complete = [...maps.values()].filter((periods) => periodIndexes.every((period) => periods.has(period)));
	const omnibus = withHolmRows(runSpec.selectedDimensions.map((axis, axisIndex) => {
		const result = friedmanRankTestV2(complete.map((periods, participantIndex) => periodIndexes.map((period, periodIndex) => selectedCoordinateAt(periods.get(period), axisIndex, `repeated[${participantIndex}].periods[${periodIndex}][${axisIndex}]`))), {
			missingCompleteBlocks: maps.size - complete.length,
			periodCountWhenEmpty: periodIndexes.length
		});
		return {
			memberId: `friedman:${axis}`,
			test: "friedman",
			design: "repeated",
			estimand: "all-period-complete-participant-coordinate-ranks",
			axis,
			axisIndex,
			selectedPeriodCanonicals: [...request.periodCanonicals],
			status: result.status,
			reason: result.reason,
			n: result.nComplete,
			effect: result.kendallsW,
			statistic: result.q,
			pRaw: result.pValueUpperTail,
			method: result.resolvedPMethod,
			ties: {
				groups: result.tieGroupCount,
				observations: result.tiedObservationCount,
				correctionSum: result.tieCorrectionSum
			},
			zeros: null,
			exactTail: result.exactTail,
			identityOverlapAudit: {
				totalEntities: maps.size,
				completeBlocks: complete.length,
				excludedIncomplete: maps.size - complete.length,
				samePhysicalEntityConfirmed: true
			}
		};
	}), `repeated-omnibus:${request.group ?? "all"}:${request.periodCanonicals.join(":")}`);
	const posthocRows = [];
	for (let earlierIndex = 0; earlierIndex < periodIndexes.length - 1; earlierIndex += 1) for (let laterIndex = earlierIndex + 1; laterIndex < periodIndexes.length; laterIndex += 1) for (const [axisIndex, axis] of runSpec.selectedDimensions.entries()) {
		const result = wilcoxonSignedRankTestV2(complete.map((periods, participantIndex) => selectedCoordinateAt(periods.get(periodIndexes[laterIndex]), axisIndex, `posthoc[${participantIndex}].later[${axisIndex}]`) - selectedCoordinateAt(periods.get(periodIndexes[earlierIndex]), axisIndex, `posthoc[${participantIndex}].earlier[${axisIndex}]`)), { missingPairs: maps.size - complete.length });
		posthocRows.push({
			memberId: `posthoc:${earlierIndex}:${laterIndex}:${axis}`,
			test: "wilcoxon-signed-rank",
			design: "repeated-posthoc",
			estimand: "later-minus-earlier-all-period-complete-coordinate",
			axis,
			axisIndex,
			earlierPeriodCanonical: request.periodCanonicals[earlierIndex],
			laterPeriodCanonical: request.periodCanonicals[laterIndex],
			status: result.status,
			reason: result.reason,
			n: result.nRanked,
			effect: result.rankBiserialLaterVsEarlier,
			statistic: result.t,
			pRaw: result.pValueTwoSided,
			method: result.resolvedPMethod,
			ties: {
				groups: result.tieGroupCount,
				observations: result.tiedObservationCount,
				correctionSum: result.tieCorrectionSum
			},
			zeros: result.nZero,
			exactTail: result.exactTail,
			identityOverlapAudit: {
				totalEntities: maps.size,
				completeBlocks: complete.length,
				excludedIncomplete: maps.size - complete.length,
				samePhysicalEntityConfirmed: true
			}
		});
	}
	const posthoc = withHolmRows(posthocRows, `repeated-posthoc:${request.group ?? "all"}:${request.periodCanonicals.join(":")}`);
	const rows = [...omnibus, ...posthoc];
	return {
		request: structuredClone(request),
		status: rows.some((row) => row.status === "available") ? "available" : "not-estimable",
		familyId: `repeated-periods:${request.group ?? "all"}`,
		familySize: rows.length,
		rows,
		reason: rows.some((row) => row.status === "available") ? null : "no-estimable-test"
	};
}
function mulberry32(seed) {
	let state = seed >>> 0;
	return () => {
		state = state + 1831565813 >>> 0;
		let value = state;
		value = Math.imul(value ^ value >>> 15, value | 1);
		value ^= value + Math.imul(value ^ value >>> 7, value | 61);
		return ((value ^ value >>> 14) >>> 0) / 4294967296;
	};
}
function createPermutationPlanV2(request, sideA, sideB) {
	const comparison = request.design === "paired" ? {
		design: "paired",
		pairedId: [],
		sideA: {
			label: request.groups[0],
			series: sideA
		},
		sideB: {
			label: request.groups[1],
			series: sideB
		}
	} : {
		design: "independent",
		sideA: {
			label: request.groups[0],
			series: sideA
		},
		sideB: {
			label: request.groups[1],
			series: sideB
		}
	};
	if (request.design === "paired") comparison.pairedId = sideA.points[0]?.participant.components.map((component) => component.name) ?? [];
	const units = getTrajectoryPermutationUnits(comparison);
	const random = mulberry32(request.seed);
	if (request.design === "paired") return {
		kind: "paired-swap-indices-v1",
		unitOrder: units.unitOrder,
		replicates: Array.from({ length: request.repetitions }, () => units.unitOrder.map((_, index) => index).filter(() => random() < .5))
	};
	return {
		kind: "independent-pool-indices-v1",
		unitOrder: units.unitOrder,
		replicates: Array.from({ length: request.repetitions }, () => {
			const indexes = units.unitOrder.map((_, index) => index);
			for (let index = indexes.length - 1; index > 0; index -= 1) {
				const selected = Math.floor(random() * (index + 1));
				[indexes[index], indexes[selected]] = [indexes[selected], indexes[index]];
			}
			return indexes;
		})
	};
}
function physicalTimeKey(point) {
	return JSON.stringify(point.time.components.map((component) => [
		component.name,
		component.type,
		component.value,
		component.declaredType ?? null
	]));
}
function pairedWholePathSeriesV2(sideA, sideB) {
	const histories = (series) => {
		const output = /* @__PURE__ */ new Map();
		for (const point of series.points) {
			const participant = physicalParticipantKey(point);
			const times = output.get(participant) ?? /* @__PURE__ */ new Set();
			times.add(physicalTimeKey(point));
			output.set(participant, times);
		}
		return output;
	};
	const a = histories(sideA);
	const b = histories(sideB);
	const aKeys = new Set(a.keys());
	const bKeys = new Set(b.keys());
	const overlapping = [...aKeys].filter((key) => bKeys.has(key));
	const requiredPeriods = /* @__PURE__ */ new Set([...sideA.points.map(physicalTimeKey), ...sideB.points.map(physicalTimeKey)]);
	const pairedComplete = new Set(overlapping.filter((key) => [...requiredPeriods].every((period) => a.get(key).has(period) && b.get(key).has(period))));
	const filter = (series) => ({
		...series,
		points: series.points.filter((point) => pairedComplete.has(physicalParticipantKey(point)))
	});
	return {
		sideA: filter(sideA),
		sideB: filter(sideB),
		audit: {
			sideAEntities: aKeys.size,
			sideBEntities: bKeys.size,
			overlappingEntities: overlapping.length,
			pairedCompleteEntities: pairedComplete.size,
			sideAOnly: [...aKeys].filter((key) => !bKeys.has(key)).length,
			sideBOnly: [...bKeys].filter((key) => !aKeys.has(key)).length,
			excludedIncompleteOverlap: overlapping.length - pairedComplete.size,
			samePhysicalEntityConfirmed: true
		}
	};
}
async function runInferenceV2(task, pathTask, contexts) {
	if (!task) return {
		inference: [],
		comparisons: [],
		planHashes: []
	};
	assertInferenceTaskV2(task, pathTask);
	const inference = [];
	const comparisons = [];
	const planHashes = [];
	for (const request of task.requests) {
		if (request.kind === "independent-period") {
			inference.push(independentPeriodInference(request, contexts, pathTask.runSpec));
			continue;
		}
		if (request.kind === "paired-periods") {
			inference.push(pairedPeriodInference(request, contexts, pathTask.runSpec));
			continue;
		}
		if (request.kind === "repeated-periods") {
			inference.push(repeatedPeriodInference(request, contexts, pathTask.runSpec));
			continue;
		}
		if (request.design === "paired" && !request.samePhysicalEntityConfirmed) {
			inference.push(disabledInference(request));
			continue;
		}
		const sideA = selectContexts(contexts, request.groups[0], "request.groups[0]")[0];
		const sideB = selectContexts(contexts, request.groups[1], "request.groups[1]")[0];
		const paired = request.design === "paired" ? pairedWholePathSeriesV2(sideA.series, sideB.series) : null;
		if (paired && paired.audit.pairedCompleteEntities === 0) {
			inference.push({
				request: structuredClone(request),
				status: "not-estimable",
				familyId: `path-comparison:${request.groups.join(":")}`,
				familySize: 0,
				rows: [{
					memberId: "identity-overlap-audit",
					...paired.audit
				}],
				reason: "no-complete-paired-participant-histories"
			});
			continue;
		}
		const comparisonSideA = paired?.sideA ?? sideA.series;
		const comparisonSideB = paired?.sideB ?? sideB.series;
		const plan = createPermutationPlanV2(request, comparisonSideA, comparisonSideB);
		const planHash = await hashAnalysisValueV1(plan);
		const result = request.design === "paired" ? compareTrajectoryPaths({
			design: "paired",
			pairedId: pathTask.runSpec.participantColumns,
			sideA: {
				label: sideA.group.display,
				series: comparisonSideA
			},
			sideB: {
				label: sideB.group.display,
				series: comparisonSideB
			},
			permutationPlan: plan
		}) : compareTrajectoryPaths({
			design: "independent",
			sideA: {
				label: sideA.group.display,
				series: comparisonSideA
			},
			sideB: {
				label: sideB.group.display,
				series: comparisonSideB
			},
			permutationPlan: plan
		});
		comparisons.push({
			groups: [...request.groups],
			design: request.design,
			seed: request.seed,
			planHash,
			identityOverlapAudit: paired?.audit ?? null,
			result
		});
		planHashes.push(planHash);
	}
	return {
		inference,
		comparisons,
		planHashes
	};
}
function finiteReplicateAudit(result) {
	const counts = result.periods.flatMap((period) => [
		...period.selectedCentroid,
		...period.fullCentroid,
		period.selectedStepDistance,
		period.fullStepDistance,
		period.selectedCumulativeDistance,
		period.fullCumulativeDistance
	]).filter((interval) => interval !== null).map((interval) => interval.finiteReplicates);
	return counts.length === 0 ? 0 : Math.min(...counts);
}
function scaleBootstrapInterval(interval, elapsed) {
	if (interval === null || elapsed === null || !Number.isFinite(elapsed) || elapsed <= 0) return null;
	return {
		...interval,
		estimate: interval.estimate / elapsed,
		lower: interval.lower / elapsed,
		upper: interval.upper / elapsed
	};
}
function physicalParticipantKey(point) {
	return JSON.stringify(point.participant.components.map((component) => [
		component.name,
		component.type,
		component.value,
		component.declaredType ?? null
	]));
}
function buildGlobalParticipantUnitsV2(contexts) {
	const units = /* @__PURE__ */ new Map();
	contexts.forEach((context, groupIndex) => {
		for (const point of context.series.points) {
			const key = physicalParticipantKey(point);
			const unit = units.get(key) ?? {
				key,
				historiesByGroup: /* @__PURE__ */ new Map()
			};
			const history = unit.historiesByGroup.get(groupIndex) ?? [];
			history.push(point);
			unit.historiesByGroup.set(groupIndex, history);
			units.set(key, unit);
		}
	});
	return [...units.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}
function createGlobalParticipantPlanV2(units, repetitions, seed) {
	if (units.length === 0) executionReject("EMPTY_GLOBAL_BOOTSTRAP_POOL", "bootstrapTask.resamplingDesign", "requires at least one physical participant history");
	const random = mulberry32(seed);
	return {
		schemaVersion: "3dena.global-participant-bootstrap-plan.v2",
		unitOrder: units.map(({ key }) => key),
		replicates: Array.from({ length: repetitions }, () => Array.from({ length: units.length }, () => Math.floor(random() * units.length))),
		generation: {
			kind: "seeded",
			algorithm: "mulberry32-uint32-v1",
			seed,
			unitSort: "utf16-code-unit-ascending",
			randomEndpoint: "zero-inclusive-one-exclusive"
		}
	};
}
function globalReplicateSeriesV2(context, groupIndex, units, draw) {
	const points = [];
	draw.forEach((unitIndex, drawIndex) => {
		const history = units[unitIndex]?.historiesByGroup.get(groupIndex);
		if (!history) return;
		for (const point of history) points.push({
			...point,
			participant: { components: [...point.participant.components.map((component) => ({ ...component })), {
				name: "@3dena/global-bootstrap-draw",
				type: "number",
				value: drawIndex
			}] },
			time: { components: point.time.components.map((component) => ({ ...component })) },
			coordinates: [...point.coordinates]
		});
	});
	if (points.length === 0) return null;
	return {
		...context.series,
		points,
		dimensions: [...context.series.dimensions],
		selectedDimensions: [...context.series.selectedDimensions],
		timeOrder: context.series.timeOrder.map((time) => ({ components: time.components.map((component) => ({ ...component })) })),
		...context.series.limits ? { limits: { ...context.series.limits } } : {}
	};
}
function globalBootstrapIntervalV2(estimate, values, eligible, confidenceLevel, repetitions, requiredFiniteReplicates) {
	if (estimate === null || !eligible) return null;
	const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
	if (finite.length < requiredFiniteReplicates) return null;
	const alpha = 1 - confidenceLevel;
	return {
		estimate,
		lower: trajectoryPercentile(finite, alpha / 2),
		upper: trajectoryPercentile(finite, 1 - alpha / 2),
		finiteReplicates: finite.length,
		requiredFiniteReplicates,
		totalReplicates: repetitions
	};
}
function summarizeGlobalParticipantBootstrapV2(context, replicatePaths, task, globalUnitCount) {
	const base = analyzeTrajectoryPath(context.series);
	const requiredFiniteReplicates = Math.max(Math.ceil(task.repetitions * .8), Math.ceil(10 / (1 - task.confidenceLevel) - 1e-12));
	let insufficientClusters = false;
	let insufficientReplicates = false;
	let anyCentroidVariation = false;
	const periods = base.periods.map((basePeriod, periodIndex) => {
		const centroidEligible = basePeriod.nUsed >= 2;
		const stepEligible = periodIndex > 0 && centroidEligible && base.periods[periodIndex - 1].nUsed >= 2;
		const cumulativeEligible = centroidEligible && base.periods.slice(0, periodIndex + 1).every((period) => period.nUsed >= 2);
		if (!centroidEligible || periodIndex > 0 && (!stepEligible || !cumulativeEligible)) insufficientClusters = true;
		const interval = (estimate, selector, eligible) => {
			const result = globalBootstrapIntervalV2(estimate, replicatePaths.map((path) => path === null ? null : selector(path)), eligible, task.confidenceLevel, task.repetitions, requiredFiniteReplicates);
			if (eligible && estimate !== null && result === null) insufficientReplicates = true;
			return result;
		};
		const selectedCentroid = Array.from({ length: 3 }, (_, dimension) => interval(basePeriod.selectedCentroid?.[dimension] ?? null, (path) => path.periods[periodIndex].selectedCentroid?.[dimension] ?? null, centroidEligible));
		const fullCentroid = Array.from({ length: context.series.dimensions.length }, (_, dimension) => {
			const values = replicatePaths.map((path) => path?.periods[periodIndex].fullCentroid?.[dimension] ?? null).filter((value) => typeof value === "number" && Number.isFinite(value));
			if (values.length > 1 && values.some((value) => value !== values[0])) anyCentroidVariation = true;
			return interval(basePeriod.fullCentroid?.[dimension] ?? null, (path) => path.periods[periodIndex].fullCentroid?.[dimension] ?? null, centroidEligible);
		});
		return {
			index: periodIndex,
			time: basePeriod.time,
			selectedCentroid,
			fullCentroid,
			selectedStepDistance: interval(basePeriod.selected3d.stepDistance, (path) => path.periods[periodIndex].selected3d.stepDistance, stepEligible),
			fullStepDistance: interval(basePeriod.fullSpace.stepDistance, (path) => path.periods[periodIndex].fullSpace.stepDistance, stepEligible),
			selectedCumulativeDistance: interval(basePeriod.selected3d.cumulativeDistance, (path) => path.periods[periodIndex].selected3d.cumulativeDistance, cumulativeEligible),
			fullCumulativeDistance: interval(basePeriod.fullSpace.cumulativeDistance, (path) => path.periods[periodIndex].fullSpace.cumulativeDistance, cumulativeEligible)
		};
	});
	const diagnostics = [];
	if (insufficientClusters) diagnostics.push({
		code: "BOOTSTRAP_INSUFFICIENT_CLUSTERS",
		severity: "warning",
		message: "Intervals requiring fewer than two participant clusters were withheld."
	});
	if (globalUnitCount === 1) diagnostics.push({
		code: "BOOTSTRAP_SINGLETON_STRATUM",
		severity: "warning",
		message: "The global participant pool contains one physical participant and has no resampling variation."
	});
	if (globalUnitCount >= 2 && !anyCentroidVariation) diagnostics.push({
		code: "BOOTSTRAP_DEGENERATE_DISTRIBUTION",
		severity: "warning",
		message: "All finite global-participant bootstrap centroid replicates are identical."
	});
	if (insufficientReplicates) diagnostics.push({
		code: "BOOTSTRAP_INSUFFICIENT_REPLICATES",
		severity: "warning",
		message: `Intervals with fewer than ${requiredFiniteReplicates} finite replicates were withheld.`
	});
	return {
		schemaVersion: "3dena.trajectory-bootstrap.v1",
		base,
		confidenceLevel: task.confidenceLevel,
		periods,
		quantileRule: {
			id: "linear-type7-v1",
			sort: "ascending-numeric",
			position: "(n-1)*p",
			interpolation: "linear-between-floor-and-ceiling",
			endpoints: "p=0-min-p=1-max"
		},
		resampling: {
			unit: "participant-complete-history",
			stratified: false,
			strata: [{
				key: {
					components: [{
						name: "@3dena/bootstrap",
						type: "string",
						value: "global-participant"
					}],
					canonical: "3dena:bootstrap:global-participant:v2",
					display: "Global participants"
				},
				unitCount: globalUnitCount
			}],
			replicateCount: task.repetitions,
			planKind: "global-participant-history-resample-indices-v2",
			generation: {
				kind: "seeded",
				algorithm: "mulberry32-uint32-v1",
				seed: task.seed,
				unitSort: "utf16-code-unit-ascending",
				randomEndpoint: "zero-inclusive-one-exclusive"
			},
			rngParityClaim: false
		},
		diagnostics
	};
}
async function runBootstrapV2(task, pathTask, contexts) {
	if (!task) return {
		results: [],
		planHashes: []
	};
	assertBootstrapTaskV2(task, pathTask);
	const results = [];
	const planHashes = [];
	const resolvedResamplingDesign = task.resamplingDesign === "auto" ? contexts.length > 1 ? "within-group" : "global-participant" : task.resamplingDesign;
	if (resolvedResamplingDesign === "global-participant") {
		const units = buildGlobalParticipantUnitsV2(contexts);
		const plan = createGlobalParticipantPlanV2(units, task.repetitions, task.seed);
		const planHash = await hashAnalysisValueV1(plan);
		for (const [groupIndex, context] of contexts.entries()) {
			const result = summarizeGlobalParticipantBootstrapV2(context, plan.replicates.map((draw) => {
				const series = globalReplicateSeriesV2(context, groupIndex, units, draw);
				return series === null ? null : analyzeTrajectoryPath(series);
			}), task, units.length);
			const finiteReplicates = finiteReplicateAudit(result);
			const requiredFiniteReplicates = Math.max(Math.ceil(task.repetitions * .8), Math.ceil(10 / (1 - task.confidenceLevel) - 1e-12));
			const status = finiteReplicates >= requiredFiniteReplicates ? "available" : "not-estimable";
			results.push({
				groupCanonical: context.group.canonical,
				status,
				notEstimableReason: status === "available" ? null : "insufficient-finite-replicates-or-participant-clusters",
				seed: task.seed,
				planHash,
				finiteReplicates,
				requiredFiniteReplicates,
				totalReplicates: task.repetitions,
				confidenceLevel: task.confidenceLevel,
				requestedResamplingDesign: task.resamplingDesign,
				resolvedResamplingDesign,
				resamplingAlgorithm: "global-participant-complete-history-mulberry32-uint32-v2",
				intervalContract: task.interval,
				rotationPolicy: task.rotationPolicy,
				speedIntervals: result.periods.map((period, periodIndex) => ({
					periodCanonical: period.time.canonical,
					selected: scaleBootstrapInterval(period.selectedStepDistance, context.dynamics.periods[periodIndex].elapsedFromPrevious),
					full: scaleBootstrapInterval(period.fullStepDistance, context.dynamics.periods[periodIndex].elapsedFromPrevious)
				})),
				result
			});
		}
		return {
			results,
			planHashes: [planHash]
		};
	}
	for (const context of contexts) {
		const explicit = task.resamplingDesign === "explicit-strata";
		const series = explicit ? {
			...context.series,
			points: context.series.points.map((point, pointIndex) => {
				const sourcePoint = context.sourcePoints[pointIndex];
				if (!sourcePoint) executionReject("TRAJECTORY_ADAPTER_SHAPE_MISMATCH", `paths.${context.group.canonical}.points[${pointIndex}]`, "has no aligned fitted source point");
				const field = task.explicitStrataField;
				const value = sourcePoint.metadata[field];
				if (value === void 0 || value === null) executionReject("MISSING_BOOTSTRAP_STRATUM", `dataset.sourceResult.result.points[${sourcePoint.index}].metadata.${field}`, "must be present and non-null for every participant history");
				return {
					...point,
					stratum: { components: [{
						name: field,
						type: scalarType(value, `metadata.${field}`),
						value
					}] }
				};
			})
		} : context.series;
		const stratifyBy = explicit ? "explicit" : "none";
		const plan = createSeededTrajectoryBootstrapPlan({
			units: getTrajectoryBootstrapUnits({
				series,
				stratifyBy
			}),
			repetitions: task.repetitions,
			seed: task.seed
		});
		const planHash = await hashAnalysisValueV1(plan);
		const result = bootstrapTrajectoryPath({
			series,
			stratifyBy,
			confidenceLevel: task.confidenceLevel,
			plan
		});
		const finiteReplicates = finiteReplicateAudit(result);
		const requiredFiniteReplicates = Math.max(Math.ceil(task.repetitions * .8), Math.ceil(10 / (1 - task.confidenceLevel) - 1e-12));
		const status = finiteReplicates >= requiredFiniteReplicates ? "available" : "not-estimable";
		results.push({
			groupCanonical: context.group.canonical,
			status,
			notEstimableReason: status === "available" ? null : "insufficient-finite-replicates-or-participant-clusters",
			seed: task.seed,
			planHash,
			finiteReplicates,
			requiredFiniteReplicates,
			totalReplicates: task.repetitions,
			confidenceLevel: task.confidenceLevel,
			requestedResamplingDesign: task.resamplingDesign,
			resolvedResamplingDesign,
			resamplingAlgorithm: "participant-complete-history-mulberry32-uint32-v1",
			intervalContract: task.interval,
			rotationPolicy: task.rotationPolicy,
			speedIntervals: result.periods.map((period, periodIndex) => ({
				periodCanonical: period.time.canonical,
				selected: scaleBootstrapInterval(period.selectedStepDistance, context.dynamics.periods[periodIndex].elapsedFromPrevious),
				full: scaleBootstrapInterval(period.fullStepDistance, context.dynamics.periods[periodIndex].elapsedFromPrevious)
			})),
			result
		});
		planHashes.push(planHash);
	}
	return {
		results,
		planHashes
	};
}
function meanFinite(values, path) {
	if (values.length === 0) executionReject("EMPTY_NETWORK_MEAN", path, "must contain at least one value");
	return values.reduce((sum, value, index) => {
		if (!Number.isFinite(value)) executionReject("NON_FINITE_NETWORK_WEIGHT", `${path}[${index}]`, "must be finite");
		const next = sum + value;
		if (!Number.isFinite(next)) executionReject("NETWORK_WEIGHT_OVERFLOW", path, "sum exceeds finite arithmetic");
		return next;
	}, 0) / values.length;
}
function runNetworkOverlaysV2(task, pathTask, source) {
	if (!task) return {
		overlays: [],
		diagnostics: []
	};
	assertNetworkOverlayTaskV2(task, pathTask);
	const result = source.result;
	const knownGroups = new Set(result.trajectory?.groupOrder.map((group) => group.canonical) ?? []);
	const knownPeriods = new Set(pathTask.runSpec.orderedPeriods.map((period) => period.sourceTimeCanonical));
	const networkWeightField = pathTask.runSpec.estimand.kind === "weighted-participant" ? pathTask.runSpec.estimand.metadataField : null;
	const diagnostics = [];
	return {
		overlays: task.requests.map((request, requestIndex) => {
			if (!knownPeriods.has(request.periodCanonical)) executionReject("UNKNOWN_TRAJECTORY_PERIOD", `networkOverlayTask.requests[${requestIndex}].periodCanonical`, "is absent from the ordered-period contract");
			if (request.groupCanonical !== null && !knownGroups.has(request.groupCanonical)) executionReject("UNKNOWN_TRAJECTORY_GROUP", `networkOverlayTask.requests[${requestIndex}].groupCanonical`, "is absent from the fitted trajectory groups");
			const rows = result.points.filter((point) => point.time?.canonical === request.periodCanonical && (request.groupCanonical === null || point.group?.canonical === request.groupCanonical));
			if (rows.length === 0) {
				diagnostics.push({
					code: "NETWORK_OVERLAY_NOT_ESTIMABLE",
					severity: "warning",
					message: `No fitted participant-period network is available for overlay request ${requestIndex + 1}.`,
					path: `networkOverlayTask.requests[${requestIndex}]`
				});
				return {
					status: "not-estimable",
					reason: "no-observed-participant-period-network",
					groupCanonical: request.groupCanonical,
					periodCanonical: request.periodCanonical,
					dimensions: [...pathTask.runSpec.selectedDimensions],
					estimand: pathTask.runSpec.estimand.kind,
					sourceRows: 0,
					participantPeriods: 0,
					effectiveParticipantN: null,
					edges: []
				};
			}
			const grouped = /* @__PURE__ */ new Map();
			for (const point of rows) {
				if (point.lineWeights.length !== result.edges.length) executionReject("NETWORK_EDGE_SHAPE_MISMATCH", `dataset.sourceResult.result.points[${point.index}].lineWeights`, "must align with the fitted edge inventory");
				const key = point.participantLabel.canonical;
				const current = grouped.get(key) ?? [];
				current.push(point);
				grouped.set(key, current);
			}
			const participantNetworks = [...grouped.values()].map((participantRows, participantIndex) => {
				return {
					weight: networkWeightField === null ? 1 : (() => {
						const values = participantRows.map((point) => point.metadata[networkWeightField]);
						if (new Set(values).size !== 1 || typeof values[0] !== "number" || !Number.isFinite(values[0]) || values[0] <= 0) executionReject("UNSTABLE_NETWORK_PARTICIPANT_WEIGHT", `networkOverlayTask.requests[${requestIndex}].participants[${participantIndex}]`, "requires one constant, finite, positive participant-period weight");
						return values[0];
					})(),
					edges: result.edges.map((_, edgeIndex) => meanFinite(participantRows.map((point) => point.lineWeights[edgeIndex]), `networkOverlayTask.requests[${requestIndex}].participants[${participantIndex}].edges[${edgeIndex}]`))
				};
			});
			const weightSum = participantNetworks.reduce((sum, participant) => sum + participant.weight, 0);
			const weightSquareSum = participantNetworks.reduce((sum, participant) => sum + participant.weight ** 2, 0);
			if (!Number.isFinite(weightSum) || weightSum <= 0 || !Number.isFinite(weightSquareSum) || weightSquareSum <= 0) executionReject("NETWORK_WEIGHT_OVERFLOW", `networkOverlayTask.requests[${requestIndex}]`, "participant weight accumulation is invalid");
			const edgeWeights = result.edges.map((_, edgeIndex) => participantNetworks.reduce((sum, participant) => sum + participant.edges[edgeIndex] * participant.weight, 0) / weightSum);
			if (edgeWeights.some((weight) => !Number.isFinite(weight))) executionReject("NETWORK_WEIGHT_OVERFLOW", `networkOverlayTask.requests[${requestIndex}].edges`, "weighted mean is non-finite");
			return {
				status: "available",
				reason: null,
				groupCanonical: request.groupCanonical,
				periodCanonical: request.periodCanonical,
				dimensions: [...pathTask.runSpec.selectedDimensions],
				estimand: pathTask.runSpec.estimand.kind,
				sourceRows: rows.length,
				participantPeriods: participantNetworks.length,
				effectiveParticipantN: weightSum ** 2 / weightSquareSum,
				edges: result.edges.map((edge, edgeIndex) => ({
					id: edge.id,
					sourceIndex: edge.sourceIndex,
					targetIndex: edge.targetIndex,
					weight: edgeWeights[edgeIndex]
				}))
			};
		}),
		diagnostics
	};
}
function fittedCodeGeometryV2(pathTask, source) {
	const selectedIndexes = pathTask.runSpec.selectedDimensions.map((dimension, index) => {
		const selected = source.result.dimensions.indexOf(dimension);
		if (selected < 0) executionReject("UNKNOWN_SELECTED_DIMENSION", `pathTask.runSpec.selectedDimensions[${index}]`, "is absent from fitted jENA code geometry");
		return selected;
	});
	return {
		schemaVersion: "3dena.longitudinal-code-geometry.v2",
		dimensions: [...pathTask.runSpec.selectedDimensions],
		nodes: source.result.nodes.map((node, index) => ({
			index,
			code: node.code,
			coordinates: selectedIndexes.map((dimensionIndex) => node.fullCoordinates[dimensionIndex])
		}))
	};
}
/**
* Executes the display-independent base path against one immutable fitted
* jENA result. Inference and bootstrap tasks are added to the same envelope by
* the versioned task coordinator; presenter changes never enter this function.
*/
async function executeLongitudinalAnalysisV2(input) {
	assertLongitudinalExecutionRequestV2(input);
	const { dataset, pathTask } = input;
	if (pathTask.datasetHash !== dataset.receipt.sha256) executionReject("TRAJECTORY_DATASET_BINDING_MISMATCH", "pathTask.datasetHash", "does not match the immutable dataset receipt");
	if (pathTask.specHash !== dataset.specHash) executionReject("TRAJECTORY_SPEC_BINDING_MISMATCH", "pathTask.specHash", "does not match the immutable fitted spec hash");
	const source = dataset.sourceResult;
	if (!source) executionReject("MISSING_SOURCE_RESULT", "dataset.sourceResult", "is required");
	if (source.hash !== pathTask.runSpec.sourceResultHash) executionReject("TRAJECTORY_SOURCE_BINDING_MISMATCH", "pathTask.runSpec.sourceResultHash", "does not match dataset.sourceResult.hash");
	if (await hashAnalysisValueV1(source.result) !== source.hash) executionReject("TRAJECTORY_SOURCE_HASH_MISMATCH", "dataset.sourceResult", "scientific result bytes do not match the bound source hash");
	if (source.sourceKind !== "raw-jena") executionReject("PREPARED_RESULT_V2_READ_ONLY", "dataset.sourceResult.sourceKind", "new V2 longitudinal runs require a fitted raw-jena result; prepared V1 artifacts remain readable only");
	const built = buildGroupInputsV2(source, pathTask.runSpec);
	let pathSet;
	try {
		pathSet = analyzeTrajectoryPathSetV2({
			schemaVersion: "3dena.trajectory-path-set-input.v2",
			dimensions: built.fullDimensions,
			selectedDimensions: [...pathTask.runSpec.selectedDimensions],
			periods: built.periods,
			cohortPolicy: pathTask.runSpec.cohortPolicy,
			estimand: pathTask.runSpec.estimand.kind === "equal-participant" ? { kind: "equal-participant-v1" } : { kind: "weighted-participant-v1" },
			groups: built.groups
		});
	} catch (error) {
		if (error instanceof TrajectoryDynamicsError) executionReject(error.code, `trajectory.${error.path}`, error.message);
		throw error;
	}
	const paths = pathSet.groups.map((group, index) => ({
		group: structuredClone(built.sourceGroups[index]),
		dynamics: group.dynamics
	}));
	const contexts = groupContextsV2(built, paths);
	const derivedInference = await runInferenceV2(input.inferenceTask, pathTask, contexts);
	const derivedBootstrap = await runBootstrapV2(input.bootstrapTask, pathTask, contexts);
	const codeGeometry = fittedCodeGeometryV2(pathTask, source);
	const derivedNetworks = runNetworkOverlaysV2(input.networkOverlayTask, pathTask, source);
	const requestHash = await hashLongitudinalExecutionRequestV2(input);
	const jenaBuildId = `jena-js@${input.execution.jenaVersion}+${input.execution.jenaCommit}:${input.execution.buildId}`;
	const bundleIdentity = {
		datasetHash: pathTask.datasetHash,
		specHash: pathTask.specHash,
		sourceResultHash: source.hash,
		requestHash,
		runId: pathTask.runId,
		jenaBuildId
	};
	const scientificCore = {
		schemaVersion: LONGITUDINAL_BUNDLE_VERSION_V2,
		identity: {
			datasetHash: bundleIdentity.datasetHash,
			specHash: bundleIdentity.specHash,
			sourceResultHash: bundleIdentity.sourceResultHash,
			jenaBuildId: bundleIdentity.jenaBuildId
		},
		runSpec: structuredClone(pathTask.runSpec),
		model: {
			type: built.model,
			fullRotationDimensions: built.fullDimensions,
			selectedDimensions: [...pathTask.runSpec.selectedDimensions]
		},
		paths,
		inference: derivedInference.inference,
		pathComparisons: derivedInference.comparisons,
		bootstrap: derivedBootstrap.results,
		codeGeometry,
		networkOverlays: derivedNetworks.overlays,
		diagnostics: [...pathSet.groups.flatMap((group) => group.dynamics.diagnostics.map((diagnostic) => ({
			...diagnostic,
			severity: diagnostic.severity
		}))), ...derivedNetworks.diagnostics],
		scientificExecution: {
			jenaVersion: input.execution.jenaVersion,
			jenaCommit: input.execution.jenaCommit,
			jenaTarballIntegrity: input.execution.jenaTarballIntegrity,
			sdkVersion: input.execution.sdkVersion,
			buildId: input.execution.buildId,
			seed: input.execution.seed,
			permutationPlanHashes: derivedInference.planHashes,
			resamplingPlanHashes: derivedBootstrap.planHashes,
			evidenceStatus: "IMPLEMENTED_UNVERIFIED"
		}
	};
	const resultHash = await hashAnalysisValueV1(scientificCore);
	return deepFreeze({
		schemaVersion: LONGITUDINAL_BUNDLE_VERSION_V2,
		identity: {
			...bundleIdentity,
			resultHash
		},
		runSpec: scientificCore.runSpec,
		model: scientificCore.model,
		paths: scientificCore.paths,
		inference: scientificCore.inference,
		pathComparisons: scientificCore.pathComparisons,
		bootstrap: scientificCore.bootstrap,
		codeGeometry: scientificCore.codeGeometry,
		networkOverlays: scientificCore.networkOverlays,
		diagnostics: scientificCore.diagnostics,
		execution: {
			target: input.execution.target,
			...scientificCore.scientificExecution
		}
	});
}
new TextEncoder();
//#endregion
//#region packages/analysis/src/index.ts
init_trajectory();
init_validation();
//#endregion
//#region packages/compute-service-node/src/contracts.ts
var NODE_COMPUTE_IPC_PROTOCOL_VERSION = "3dena.compute-node-ipc.v1";
//#endregion
//#region packages/dataset-workflow/src/limits.ts
function workflowLimits(limits) {
	return Object.freeze({
		schemaVersion: "3dena.dataset-workflow-limits.v1",
		...limits
	});
}
workflowLimits(DEFAULT_TABULAR_IMPORT_LIMITS);
workflowLimits(HARD_TABULAR_IMPORT_LIMITS);
Object.freeze({
	queued: /* @__PURE__ */ new Set([
		"leased",
		"cancelled",
		"timed_out",
		"expired",
		"deleting"
	]),
	leased: /* @__PURE__ */ new Set([
		"queued",
		"starting",
		"cancelled",
		"timed_out",
		"expired",
		"deleting"
	]),
	starting: /* @__PURE__ */ new Set([
		"running",
		"cancelling",
		"queued",
		"timed_out",
		"expired",
		"failed"
	]),
	running: /* @__PURE__ */ new Set([
		"cancelling",
		"queued",
		"succeeded",
		"timed_out",
		"expired",
		"failed"
	]),
	cancelling: /* @__PURE__ */ new Set([
		"queued",
		"cancelled",
		"timed_out",
		"expired",
		"deleting",
		"failed"
	]),
	succeeded: /* @__PURE__ */ new Set(["expired", "deleting"]),
	failed: /* @__PURE__ */ new Set(["expired", "deleting"]),
	cancelled: /* @__PURE__ */ new Set(["expired", "deleting"]),
	timed_out: /* @__PURE__ */ new Set(["expired", "deleting"]),
	expired: /* @__PURE__ */ new Set(["deleting"]),
	deleting: /* @__PURE__ */ new Set(["deleted"]),
	deleted: /* @__PURE__ */ new Set()
});
Object.freeze(["compute-requests/", "compute-results/"]);
//#endregion
//#region packages/compute-service-http/src/longitudinal-contracts.ts
var LONGITUDINAL_COMPUTE_TASK_KIND_V2 = "longitudinal-analysis-v2";
Object.freeze([
	"GET",
	"POST",
	"PUT",
	"DELETE",
	"OPTIONS"
]);
Object.freeze(Object.keys(HARD_ANALYSIS_LIMITS));
//#endregion
//#region packages/compute-service-node/src/scientific/contracts.ts
var SCIENTIFIC_WORKER_PROTOCOL_VERSION = "3dena.compute-scientific-worker.v1";
var SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2 = LONGITUDINAL_COMPUTE_TASK_KIND_V2;
var SCIENTIFIC_RESULT_ARTIFACT_VERSION = "3dena.compute-scientific-result-artifact.v1";
var SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION = "3dena.compute-scientific-longitudinal-result-artifact.v2";
var SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION = "3dena.compute-scientific-artifact-put-request.v1";
var SCIENTIFIC_PUBLICATION_REQUEST_VERSION = "3dena.compute-scientific-publication-request.v1";
var SCIENTIFIC_WORKER_FAILURE_VERSION = "3dena.compute-scientific-worker-failure.v1";
//#endregion
//#region packages/compute-service-node/src/scientific/errors.ts
var MESSAGES = Object.freeze({
	INVALID_CONFIGURATION: "The scientific worker configuration is invalid.",
	INVALID_EXECUTION_INPUT: "The scientific execution input is invalid.",
	INVALID_WORKER_MESSAGE: "The scientific worker message is invalid.",
	ARTIFACT_TOO_LARGE: "The scientific result artifact exceeds its fixed limit.",
	ARTIFACT_CHECKSUM_MISMATCH: "The scientific result artifact checksum does not match.",
	ARTIFACT_BINDING_MISMATCH: "The scientific result artifact does not match its execution owner.",
	IMMUTABLE_ARTIFACT_CONFLICT: "The immutable scientific result artifact conflicts with existing bytes.",
	PUBLICATION_RECEIPT_MISMATCH: "The scientific publication receipt does not match the request.",
	SESSION_ABORTED: "The scientific worker session was aborted.",
	STORE_OPERATION_FAILED: "The scientific artifact store operation failed."
});
var ScientificComputeWorkerError = class extends Error {
	code;
	constructor(code) {
		super(MESSAGES[code]);
		this.name = "ScientificComputeWorkerError";
		this.code = code;
		Object.setPrototypeOf(this, new.target.prototype);
	}
};
function scientificWorkerError(code) {
	throw new ScientificComputeWorkerError(code);
}
//#endregion
//#region packages/compute-service-node/src/scientific/validation.ts
var SHA256 = /^[a-f0-9]{64}$/u;
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasExactKeys(value, expected) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
function nonEmptyString(value) {
	return typeof value === "string" && value.length > 0;
}
function safeNonNegativeInteger(value) {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
function bindPersistentLongitudinalRequestV2(request) {
	try {
		assertLongitudinalExecutionRequestV2(request);
	} catch {
		scientificWorkerError("INVALID_EXECUTION_INPUT");
	}
	const build = getAnalysisBuildIdentityV2();
	if (process.env.NODE_ENV === "production" && !build.bound) scientificWorkerError("INVALID_EXECUTION_INPUT");
	for (const field of [
		"jenaVersion",
		"jenaCommit",
		"jenaTarballIntegrity",
		"sdkVersion",
		"buildId"
	]) if (request.execution[field] !== build[field]) scientificWorkerError("INVALID_EXECUTION_INPUT");
	return structuredClone({
		...request,
		execution: {
			...request.execution,
			target: "persistent-compute-service",
			jenaVersion: build.jenaVersion,
			jenaCommit: build.jenaCommit,
			jenaTarballIntegrity: build.jenaTarballIntegrity,
			sdkVersion: build.sdkVersion,
			buildId: build.buildId
		}
	});
}
async function bindAndHashPersistentLongitudinalRequestV2(request) {
	const bound = bindPersistentLongitudinalRequestV2(request);
	try {
		return {
			request: bound,
			requestHash: await hashLongitudinalExecutionRequestV2(bound)
		};
	} catch {
		scientificWorkerError("INVALID_EXECUTION_INPUT");
	}
}
function assertObjectDescriptor(value) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"key",
		"sha256",
		"byteLength"
	]) || !nonEmptyString(value.key) || typeof value.sha256 !== "string" || !SHA256.test(value.sha256) || !safeNonNegativeInteger(value.byteLength)) scientificWorkerError("INVALID_WORKER_MESSAGE");
}
function assertComputeOwner(value) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"contractVersion",
		"datasetHash",
		"specHash",
		"runId",
		"taskId"
	]) || value.contractVersion !== "3dena.compute-task-owner.v1" || typeof value.datasetHash !== "string" || !SHA256.test(value.datasetHash) || typeof value.specHash !== "string" || !SHA256.test(value.specHash) || !nonEmptyString(value.runId) || !nonEmptyString(value.taskId)) scientificWorkerError("INVALID_WORKER_MESSAGE");
}
function assertLease(value) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"version",
		"leaseId",
		"holderId",
		"epoch",
		"issuedAtMs",
		"expiresAtMs"
	]) || value.version !== "3dena.compute-lease.v1" || !nonEmptyString(value.leaseId) || !nonEmptyString(value.holderId) || !safeNonNegativeInteger(value.epoch) || !safeNonNegativeInteger(value.issuedAtMs) || !safeNonNegativeInteger(value.expiresAtMs)) scientificWorkerError("INVALID_WORKER_MESSAGE");
}
function descriptorsEqual(left, right) {
	return left.key === right.key && left.sha256 === right.sha256 && left.byteLength === right.byteLength;
}
function ownersEqual(left, right) {
	return left.contractVersion === right.contractVersion && left.datasetHash === right.datasetHash && left.specHash === right.specHash && left.runId === right.runId && left.taskId === right.taskId;
}
function leasesEqual(left, right) {
	return left.version === right.version && left.leaseId === right.leaseId && left.holderId === right.holderId && left.epoch === right.epoch && left.issuedAtMs === right.issuedAtMs && left.expiresAtMs === right.expiresAtMs;
}
function assertDataset(value) {
	if (!isRecord(value) || value.schemaVersion !== "3dena.analysis-execution-dataset.v1" && value.schemaVersion !== "3dena.analysis-execution-dataset.v2" || !Object.hasOwn(value, "receipt") || !Object.hasOwn(value, "specHash") || !Object.hasOwn(value, "buildId") || typeof value.specHash !== "string" || !SHA256.test(value.specHash) || !nonEmptyString(value.buildId) || value.generatedAt !== void 0 && (!nonEmptyString(value.generatedAt) || Number.isNaN(Date.parse(value.generatedAt)))) scientificWorkerError("INVALID_EXECUTION_INPUT");
	try {
		assertDatasetReceiptV1(value.receipt);
	} catch {
		scientificWorkerError("INVALID_EXECUTION_INPUT");
	}
}
function assertLongitudinalRequestShape(value) {
	try {
		assertLongitudinalExecutionRequestV2(value);
	} catch {
		scientificWorkerError("INVALID_EXECUTION_INPUT");
	}
}
function assertScientificLongitudinalExecutionInput(value, context) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"version",
		"kind",
		"source",
		"owner",
		"deadlineAtMs",
		"requestHash",
		"request"
	]) || value.version !== "3dena.compute-scientific-longitudinal-execution-input.v2" || value.kind !== SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2 || !safeNonNegativeInteger(value.deadlineAtMs) || typeof value.requestHash !== "string" || !SHA256.test(value.requestHash)) scientificWorkerError("INVALID_EXECUTION_INPUT");
	try {
		assertObjectDescriptor(value.source);
		assertComputeOwner(value.owner);
		assertLongitudinalRequestShape(value.request);
	} catch {
		scientificWorkerError("INVALID_EXECUTION_INPUT");
	}
	const request = value.request;
	if (value.owner.datasetHash !== request.pathTask.datasetHash || value.owner.datasetHash !== request.dataset.receipt.sha256 || value.owner.specHash !== request.pathTask.specHash || value.owner.specHash !== request.dataset.specHash || value.owner.runId !== request.pathTask.runId || request.dataset.sourceResult?.hash !== request.pathTask.runSpec.sourceResultHash) scientificWorkerError("INVALID_EXECUTION_INPUT");
	if (context !== void 0 && (!descriptorsEqual(value.source, context.request.input) || !ownersEqual(value.owner, context.owner) || context.request.taskKind !== SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2 || context.request.deadlineAtMs !== value.deadlineAtMs)) scientificWorkerError("INVALID_EXECUTION_INPUT");
}
function assertScientificExecutionInput(value, context) {
	if (isRecord(value) && value.version === "3dena.compute-scientific-longitudinal-execution-input.v2") {
		assertScientificLongitudinalExecutionInput(value, context);
		return;
	}
	if (!isRecord(value) || !hasExactKeys(value, [
		"version",
		"source",
		"dataset",
		"task"
	]) || value.version !== "3dena.compute-scientific-execution-input.v1") scientificWorkerError("INVALID_EXECUTION_INPUT");
	try {
		assertObjectDescriptor(value.source);
		assertDataset(value.dataset);
		assertAnalysisTaskV1(value.task);
	} catch {
		scientificWorkerError("INVALID_EXECUTION_INPUT");
	}
	if (value.task.owner.contractVersion !== "3dena.contract.v1" || value.dataset.receipt.sha256 !== value.task.owner.datasetHash || value.dataset.specHash !== value.task.owner.specHash) scientificWorkerError("INVALID_EXECUTION_INPUT");
	if (context !== void 0) {
		if (!descriptorsEqual(value.source, context.request.input) || context.owner.datasetHash !== value.task.owner.datasetHash || context.owner.specHash !== value.task.owner.specHash || context.owner.runId !== value.task.owner.runId || context.owner.taskId !== value.task.owner.taskId || context.request.taskKind !== value.task.kind || context.request.deadlineAtMs !== value.task.deadlineEpochMilliseconds) scientificWorkerError("INVALID_EXECUTION_INPUT");
	}
}
function assertScientificLaunchPayload(value, context) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"version",
		"input",
		"publication"
	]) || value.version !== "3dena.compute-scientific-worker-launch.v1" || !isRecord(value.publication) || !hasExactKeys(value.publication, [
		"executionId",
		"resultObjectKey",
		"owner",
		"lease"
	]) || value.publication.executionId !== context.executionId || value.publication.resultObjectKey !== context.resultObjectKey) scientificWorkerError("INVALID_EXECUTION_INPUT");
	assertScientificExecutionInput(value.input, context);
	try {
		assertComputeOwner(value.publication.owner);
		assertLease(value.publication.lease);
	} catch {
		scientificWorkerError("INVALID_EXECUTION_INPUT");
	}
	if (!ownersEqual(value.publication.owner, context.owner) || !leasesEqual(value.publication.lease, context.lease)) scientificWorkerError("INVALID_EXECUTION_INPUT");
}
function assertBaseLaunchMessage(value) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"version",
		"type",
		"context",
		"payload"
	]) || value.version !== "3dena.compute-node-ipc.v1" || value.type !== "launch" || !isRecord(value.context)) scientificWorkerError("INVALID_EXECUTION_INPUT");
	const context = value.context;
	if (!hasExactKeys(context, [
		"owner",
		"taskRef",
		"request",
		"lease",
		"executionId",
		"resultObjectKey"
	]) || !nonEmptyString(context.taskRef) || !nonEmptyString(context.executionId) || !nonEmptyString(context.resultObjectKey) || !isRecord(context.request)) scientificWorkerError("INVALID_EXECUTION_INPUT");
	try {
		assertComputeOwner(context.owner);
		assertLease(context.lease);
		if (!hasExactKeys(context.request, [
			"version",
			"owner",
			"taskKind",
			"input",
			"deadlineAtMs",
			"expiresAtMs"
		]) || context.request.version !== "3dena.compute-task-request.v1" || !nonEmptyString(context.request.taskKind) || !safeNonNegativeInteger(context.request.deadlineAtMs) || !safeNonNegativeInteger(context.request.expiresAtMs) || context.request.expiresAtMs < context.request.deadlineAtMs) scientificWorkerError("INVALID_EXECUTION_INPUT");
		assertComputeOwner(context.request.owner);
		assertObjectDescriptor(context.request.input);
		if (!ownersEqual(context.request.owner, context.owner)) scientificWorkerError("INVALID_EXECUTION_INPUT");
	} catch {
		scientificWorkerError("INVALID_EXECUTION_INPUT");
	}
	assertScientificLaunchPayload(value.payload, context);
}
function assertArtifactPutAck(value, executionId, descriptor) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"version",
		"protocolVersion",
		"type",
		"executionId",
		"object"
	]) || value.version !== "3dena.compute-scientific-artifact-put-ack.v1" || value.protocolVersion !== "3dena.compute-scientific-worker.v1" || value.type !== "artifact-put-ack" || value.executionId !== executionId) scientificWorkerError("INVALID_WORKER_MESSAGE");
	assertObjectDescriptor(value.object);
	if (!descriptorsEqual(value.object, descriptor)) scientificWorkerError("INVALID_WORKER_MESSAGE");
}
function assertPublicationReceipt(value, request) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"version",
		"accepted",
		"executionId",
		"owner",
		"leaseId",
		"leaseEpoch",
		"object",
		"publishedAtMs"
	]) || value.version !== "3dena.compute-scientific-publication-receipt.v1" || value.accepted !== true || value.executionId !== request.executionId || value.leaseId !== request.lease.leaseId || value.leaseEpoch !== request.lease.epoch || !safeNonNegativeInteger(value.publishedAtMs)) scientificWorkerError("PUBLICATION_RECEIPT_MISMATCH");
	assertComputeOwner(value.owner);
	assertObjectDescriptor(value.object);
	if (!ownersEqual(value.owner, request.owner) || !descriptorsEqual(value.object, request.object)) scientificWorkerError("PUBLICATION_RECEIPT_MISMATCH");
}
function assertPublicationAck(value, request) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"version",
		"protocolVersion",
		"type",
		"receipt"
	]) || value.version !== "3dena.compute-scientific-publication-ack.v1" || value.protocolVersion !== "3dena.compute-scientific-worker.v1" || value.type !== "publication-ack") scientificWorkerError("INVALID_WORKER_MESSAGE");
	assertPublicationReceipt(value.receipt, request);
}
//#endregion
//#region packages/compute-service-node/src/scientific/worker-runtime.ts
var MAX_ACK_WAIT_MS = 3e4;
function canonicalJson(value) {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("NON_FINITE");
		return Object.is(value, -0) ? "-0" : JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
	if (!isRecord(value)) throw new TypeError("UNSUPPORTED_VALUE");
	return `{${Object.keys(value).sort().map((key) => {
		if (value[key] === void 0) throw new TypeError("UNDEFINED_VALUE");
		return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
	}).join(",")}}`;
}
function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function isSerializable(value) {
	return typeof value === "object" && value !== null;
}
function classifyExecutionFailure(error, deadlineEpochMilliseconds) {
	if (Date.now() >= deadlineEpochMilliseconds) return "DEADLINE_EXCEEDED";
	if (error instanceof TypeError || typeof error === "object" && error !== null && "name" in error && (error.name === "AnalysisValidationError" || error.name === "AnalysisTaskExecutionError" || error.name === "LongitudinalExecutionErrorV2")) return "INVALID_INPUT";
	return "EXECUTION_FAILED";
}
/**
* Pure durable-V2 worker operation used by the child-process protocol and by
* the cross-package HTTP-bytes integration test. It deliberately repeats the
* server build/request binding immediately before scientific execution.
*/
async function executeScientificLongitudinalInputV2(input) {
	const bound = await bindAndHashPersistentLongitudinalRequestV2(input.request);
	if (bound.requestHash !== input.requestHash) throw new TypeError("LONGITUDINAL_REQUEST_HASH_MISMATCH");
	const bundle = await executeLongitudinalAnalysisV2(bound.request);
	if (bundle.identity.requestHash !== bound.requestHash) throw new TypeError("LONGITUDINAL_RESULT_REQUEST_BINDING_MISMATCH");
	return {
		version: SCIENTIFIC_LONGITUDINAL_RESULT_ARTIFACT_VERSION,
		owner: { ...input.owner },
		taskKind: SCIENTIFIC_LONGITUDINAL_TASK_KIND_V2,
		requestHash: bound.requestHash,
		bundle
	};
}
function startScientificWorkerProcess() {
	if (typeof process.send !== "function") process.exit(1);
	let launch;
	let ready = false;
	let exiting = false;
	let pendingAck;
	const exitImmediately = (code) => {
		if (exiting) return;
		exiting = true;
		if (pendingAck !== void 0) {
			clearTimeout(pendingAck.timer);
			pendingAck.reject();
			pendingAck = void 0;
		}
		process.exit(code);
	};
	const send = async (message) => {
		if (exiting || typeof process.send !== "function" || !isSerializable(message)) throw new TypeError("IPC_UNAVAILABLE");
		await new Promise((resolve, reject) => {
			try {
				process.send?.(message, void 0, void 0, (error) => {
					if (error === null) resolve();
					else reject(/* @__PURE__ */ new TypeError("IPC_SEND_FAILED"));
				});
			} catch {
				reject(/* @__PURE__ */ new TypeError("IPC_SEND_FAILED"));
			}
		});
	};
	const fail = async (code) => {
		if (exiting) return;
		const executionId = launch?.publication.executionId;
		if (ready && executionId !== void 0) try {
			await send({
				version: SCIENTIFIC_WORKER_FAILURE_VERSION,
				protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
				type: "failed",
				executionId,
				code
			});
		} catch {}
		exitImmediately(1);
	};
	const ackTimeout = (deadlineEpochMilliseconds) => Math.max(1, Math.min(MAX_ACK_WAIT_MS, deadlineEpochMilliseconds - Date.now()));
	const awaitArtifactAck = async (request, deadlineEpochMilliseconds) => {
		if (pendingAck !== void 0) throw new TypeError("ACK_ALREADY_PENDING");
		let waiter;
		let cancelWaiter = () => void 0;
		const promise = new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if (pendingAck?.kind === "artifact") pendingAck = void 0;
				reject(/* @__PURE__ */ new TypeError("ARTIFACT_ACK_TIMEOUT"));
			}, ackTimeout(deadlineEpochMilliseconds));
			waiter = {
				kind: "artifact",
				descriptor: request.object,
				resolve,
				reject: () => reject(/* @__PURE__ */ new TypeError("ARTIFACT_ACK_CANCELLED")),
				timer
			};
			pendingAck = waiter;
			cancelWaiter = () => {
				clearTimeout(waiter.timer);
				if (pendingAck === waiter) pendingAck = void 0;
				waiter.reject();
			};
		});
		promise.catch(() => {});
		try {
			await send(request);
		} catch {
			cancelWaiter();
			throw new TypeError("IPC_SEND_FAILED");
		}
		return promise;
	};
	const awaitPublicationAck = async (request, deadlineEpochMilliseconds) => {
		if (pendingAck !== void 0) throw new TypeError("ACK_ALREADY_PENDING");
		let waiter;
		let cancelWaiter = () => void 0;
		const promise = new Promise((resolve, reject) => {
			waiter = {
				kind: "publication",
				request,
				resolve,
				reject: () => reject(/* @__PURE__ */ new TypeError("PUBLICATION_ACK_CANCELLED")),
				timer: setTimeout(() => {
					if (pendingAck?.kind === "publication") pendingAck = void 0;
					reject(/* @__PURE__ */ new TypeError("PUBLICATION_ACK_TIMEOUT"));
				}, ackTimeout(deadlineEpochMilliseconds))
			};
			pendingAck = waiter;
			cancelWaiter = () => {
				clearTimeout(waiter.timer);
				if (pendingAck === waiter) pendingAck = void 0;
				waiter.reject();
			};
		});
		promise.catch(() => {});
		try {
			await send(request);
		} catch {
			cancelWaiter();
			throw new TypeError("IPC_SEND_FAILED");
		}
		return promise;
	};
	const execute = async () => {
		if (launch === void 0) return;
		const { input, publication } = launch;
		const deadlineAtMs = input.version === "3dena.compute-scientific-longitudinal-execution-input.v2" ? input.deadlineAtMs : input.task.deadlineEpochMilliseconds;
		if (Date.now() >= deadlineAtMs) {
			await fail("DEADLINE_EXCEEDED");
			return;
		}
		let artifact;
		try {
			if (input.version === "3dena.compute-scientific-longitudinal-execution-input.v2") artifact = await executeScientificLongitudinalInputV2(input);
			else {
				const envelope = await executeAnalysisTask(input.dataset, input.task);
				artifact = {
					version: SCIENTIFIC_RESULT_ARTIFACT_VERSION,
					owner: { ...envelope.owner },
					taskKind: envelope.taskKind,
					envelope
				};
			}
		} catch (error) {
			await fail(classifyExecutionFailure(error, deadlineAtMs));
			return;
		}
		if (Date.now() >= deadlineAtMs) {
			await fail("DEADLINE_EXCEEDED");
			return;
		}
		let bytes;
		try {
			bytes = new TextEncoder().encode(`${canonicalJson(artifact)}\n`);
		} catch {
			await fail("EXECUTION_FAILED");
			return;
		}
		if (bytes.byteLength > 268435456) {
			await fail("ARTIFACT_STORE_FAILED");
			return;
		}
		const descriptor = {
			key: publication.resultObjectKey,
			sha256: sha256(bytes),
			byteLength: bytes.byteLength
		};
		const artifactRequest = {
			version: SCIENTIFIC_ARTIFACT_PUT_REQUEST_VERSION,
			protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
			type: "artifact-put-request",
			executionId: publication.executionId,
			owner: { ...publication.owner },
			lease: { ...publication.lease },
			object: descriptor,
			bytes
		};
		try {
			await awaitArtifactAck(artifactRequest, deadlineAtMs);
		} catch {
			await fail(Date.now() >= deadlineAtMs ? "DEADLINE_EXCEEDED" : "ARTIFACT_STORE_FAILED");
			return;
		}
		const publicationRequest = {
			version: SCIENTIFIC_PUBLICATION_REQUEST_VERSION,
			protocolVersion: SCIENTIFIC_WORKER_PROTOCOL_VERSION,
			type: "publication-request",
			executionId: publication.executionId,
			owner: { ...publication.owner },
			lease: { ...publication.lease },
			object: descriptor
		};
		try {
			await awaitPublicationAck(publicationRequest, deadlineAtMs);
		} catch {
			await fail(Date.now() >= deadlineAtMs ? "DEADLINE_EXCEEDED" : "PUBLICATION_FAILED");
			return;
		}
		exitImmediately(0);
	};
	process.on("message", (message) => {
		if (!ready) {
			try {
				assertBaseLaunchMessage(message);
				launch = message.payload;
			} catch {
				exitImmediately(1);
				return;
			}
			ready = true;
			send({
				version: NODE_COMPUTE_IPC_PROTOCOL_VERSION,
				type: "ready",
				executionId: launch.publication.executionId
			}).then(() => execute()).catch(() => exitImmediately(1));
			return;
		}
		const pending = pendingAck;
		if (pending === void 0) {
			fail("PROTOCOL_FAILED");
			return;
		}
		try {
			if (pending.kind === "artifact") {
				assertArtifactPutAck(message, launch.publication.executionId, pending.descriptor);
				clearTimeout(pending.timer);
				pendingAck = void 0;
				pending.resolve(message);
			} else {
				assertPublicationAck(message, pending.request);
				clearTimeout(pending.timer);
				pendingAck = void 0;
				pending.resolve(message);
			}
		} catch {
			clearTimeout(pending.timer);
			pendingAck = void 0;
			pending.reject();
			fail("PROTOCOL_FAILED");
		}
	});
	process.once("SIGTERM", () => exitImmediately(143));
	process.once("uncaughtException", () => exitImmediately(1));
	process.once("unhandledRejection", () => exitImmediately(1));
}
//#endregion
//#region packages/compute-service-node/src/scientific/worker-entry.ts
startScientificWorkerProcess();
//#endregion
export {};
