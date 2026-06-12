import { getParser } from "./script-parser.js";
// Unity built-in types to ignore
const UNITY_BUILTIN_TYPES = new Set([
    // Core Unity types
    "MonoBehaviour",
    "NetworkBehaviour",
    "ScriptableObject",
    "GameObject",
    "Transform",
    "RectTransform",
    "Component",
    "Behaviour",
    "Object",
    // Rendering
    "Renderer",
    "MeshRenderer",
    "SkinnedMeshRenderer",
    "SpriteRenderer",
    "LineRenderer",
    "TrailRenderer",
    "MeshFilter",
    // Physics
    "Rigidbody",
    "Rigidbody2D",
    "Collider",
    "Collider2D",
    "BoxCollider",
    "BoxCollider2D",
    "SphereCollider",
    "CapsuleCollider",
    "CapsuleCollider2D",
    "MeshCollider",
    "CircleCollider2D",
    "PolygonCollider2D",
    "EdgeCollider2D",
    // Audio
    "AudioSource",
    "AudioListener",
    "AudioClip",
    // Utilities
    "Debug",
    "Time",
    "Input",
    "Screen",
    "Application",
    "Resources",
    "Mathf",
    "Random",
    "Physics",
    "Physics2D",
    "Vector2",
    "Vector3",
    "Vector4",
    "Quaternion",
    "Color",
    "Color32",
    "Matrix4x4",
    "Rect",
    "Bounds",
    "Ray",
    "RaycastHit",
    "LayerMask",
    // Animation
    "Animator",
    "Animation",
    "AnimationClip",
    // UI
    "Canvas",
    "CanvasGroup",
    "CanvasRenderer",
    "Image",
    "Text",
    "Button",
    "Slider",
    "Toggle",
    "InputField",
    // Cameras
    "Camera",
    // Lighting
    "Light",
    // NavMesh
    "NavMeshAgent",
    "NavMeshObstacle",
    // Particles
    "ParticleSystem",
    // Coroutines / Mono lifecycle
    "Coroutine",
    "WaitForSeconds",
    "WaitForEndOfFrame",
    "WaitUntil",
    "WaitWhile",
    // C# system types that might appear as receivers
    "String",
    "Math",
    "Convert",
    "Console",
    "Array",
    "List",
    "Dictionary",
    "HashSet",
    "Queue",
    "Stack",
    "Linq",
    "Enumerable",
    "Task",
    "Thread",
    "Action",
    "Func",
    "EventHandler",
    "Type",
    "Enum",
    "BitConverter",
    "GC",
    "GUILayout",
    "GUI",
    "EditorGUILayout",
    "EditorGUI",
    "EditorUtility",
    "AssetDatabase",
    "Undo",
    "Selection",
    "PrefabUtility",
    "Handles",
    "SceneView",
    "Gizmos",
    "TextMeshPro",
    "TextMeshProUGUI",
]);
const CS_PRIMITIVE_KEYWORDS = new Set([
    "int",
    "float",
    "bool",
    "string",
    "double",
    "long",
    "void",
    "byte",
    "char",
    "object",
    "var",
    "uint",
    "ulong",
    "ushort",
    "short",
    "sbyte",
    "decimal",
]);
function isUppercase(name) {
    return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
}
/**
 * Walk left along a member-access chain and return the leftmost identifier text.
 * Handles singleton patterns like DailyBlitzManager.Instance.Initialize():
 * the expression chain is (DailyBlitzManager).Instance and root is "DailyBlitzManager".
 */
function extractRootIdentifier(node) {
    if (node.type === "identifier")
        return node.text;
    if (node.type === "member_access_expression") {
        const expr = node.childForFieldName("expression");
        if (expr)
            return extractRootIdentifier(expr);
    }
    return null;
}
/**
 * Walk all descendants of a node, calling visitor for each.
 */
function walkAll(node, visitor) {
    visitor(node);
    for (const child of node.children) {
        walkAll(child, visitor);
    }
}
function collectClassBodies(root) {
    const ranges = [];
    function walk(node) {
        if (node.type === "class_declaration" || node.type === "struct_declaration") {
            const nameNode = node.childForFieldName("name");
            const bodyNode = node.childForFieldName("body");
            if (nameNode && bodyNode) {
                ranges.push({
                    className: nameNode.text,
                    startIndex: bodyNode.startIndex,
                    endIndex: bodyNode.endIndex,
                });
            }
        }
        for (const child of node.namedChildren) {
            walk(child);
        }
    }
    walk(root);
    return ranges;
}
function findSourceClass(index, classBodies) {
    // Find the most specific (innermost) class body that contains this index
    let best = null;
    for (const range of classBodies) {
        if (index >= range.startIndex && index <= range.endIndex) {
            if (!best || range.endIndex - range.startIndex < best.endIndex - best.startIndex) {
                best = range;
            }
        }
    }
    return best?.className ?? "";
}
/**
 * Extract a type name from a generic_name node, e.g. "GetComponent<PlayerController>"
 * returns "PlayerController".
 */
function extractGenericTypeArg(genericNameNode) {
    // generic_name structure: identifier type_argument_list
    // type_argument_list: < type_arguments >
    const typeArgList = genericNameNode.namedChildren.find((c) => c.type === "type_argument_list");
    if (!typeArgList)
        return null;
    // The type arguments are the children of type_argument_list that are type nodes
    // Typically: `<`, identifier/predefined_type, `>`
    for (const child of typeArgList.namedChildren) {
        if (child.type === "identifier" ||
            child.type === "qualified_name" ||
            child.type === "generic_name") {
            return child.text.split("<")[0].trim();
        }
    }
    return null;
}
function isFilteredType(name) {
    return UNITY_BUILTIN_TYPES.has(name) || CS_PRIMITIVE_KEYWORDS.has(name);
}
function typeNamesFromNode(typeNode) {
    switch (typeNode.type) {
        case "identifier":
            return [typeNode.text];
        case "generic_name": {
            // List<T>, Dictionary<K,V> — skip outer name, recurse into type args
            const typeArgList = typeNode.namedChildren.find((c) => c.type === "type_argument_list");
            if (!typeArgList)
                return [];
            const names = [];
            for (const arg of typeArgList.namedChildren) {
                if (arg.type === "identifier" || arg.type === "generic_name") {
                    names.push(...typeNamesFromNode(arg));
                }
            }
            return names;
        }
        case "array_type": {
            const inner = typeNode.childForFieldName("type");
            return inner ? typeNamesFromNode(inner) : [];
        }
        case "nullable_type": {
            if (typeNode.namedChildren.length === 0)
                return [];
            return typeNamesFromNode(typeNode.namedChildren[0]);
        }
        default:
            return [];
    }
}
export function extractRelationships(content) {
    const parser = getParser();
    if (!parser) {
        throw new Error("Script parser not initialized. Call initScriptParser() first.");
    }
    const tree = parser.parse(content);
    if (!tree)
        return [];
    const results = [];
    const classBodies = collectClassBodies(tree.rootNode);
    walkAll(tree.rootNode, (node) => {
        const sourceClassName = findSourceClass(node.startIndex, classBodies);
        if (!sourceClassName)
            return;
        // Pattern 1: GetComponent<T>() calls
        if (node.type === "invocation_expression") {
            const fnNode = node.childForFieldName("function");
            if (fnNode) {
                // GetComponent<T> appears as a member_access_expression or directly as generic_name
                // e.g. GetComponent<PlayerController>() -> function is generic_name
                // or GetComponent<PlayerController> after dot -> member_access_expression -> generic_name
                let genericName = null;
                if (fnNode.type === "generic_name") {
                    genericName = fnNode;
                }
                else if (fnNode.type === "member_access_expression") {
                    const nameField = fnNode.childForFieldName("name");
                    if (nameField && nameField.type === "generic_name") {
                        genericName = nameField;
                    }
                }
                if (genericName) {
                    const identNode = genericName.namedChildren.find((c) => c.type === "identifier");
                    const methodName = identNode?.text ?? genericName.text.split("<")[0];
                    if (methodName === "GetComponent" ||
                        methodName === "AddComponent" ||
                        methodName === "GetComponentInChildren" ||
                        methodName === "GetComponentInParent") {
                        const typeArg = extractGenericTypeArg(genericName);
                        if (typeArg !== null && !UNITY_BUILTIN_TYPES.has(typeArg)) {
                            results.push({
                                sourceClassName,
                                edgeType: "CALLS",
                                targetClassName: typeArg,
                            });
                        }
                    }
                }
                // Pattern 2: Static method calls — Receiver.Method() where receiver is uppercase
                // Handles direct (Foo.Bar()) and chained (Foo.Instance.Bar()) patterns.
                if (fnNode.type === "member_access_expression") {
                    const exprNode = fnNode.childForFieldName("expression");
                    if (exprNode) {
                        const rootId = extractRootIdentifier(exprNode);
                        if (rootId !== null &&
                            isUppercase(rootId) &&
                            !UNITY_BUILTIN_TYPES.has(rootId) &&
                            rootId !== sourceClassName) {
                            results.push({
                                sourceClassName,
                                edgeType: "CALLS",
                                targetClassName: rootId,
                            });
                        }
                    }
                }
            }
        }
        // Pattern 3: Constructor calls — new T(...)
        if (node.type === "object_creation_expression") {
            const typeNode = node.childForFieldName("type");
            if (typeNode) {
                const typeName = typeNode.text.split("<")[0].trim();
                if (isUppercase(typeName) && !UNITY_BUILTIN_TYPES.has(typeName)) {
                    results.push({
                        sourceClassName,
                        edgeType: "CALLS",
                        targetClassName: typeName,
                    });
                }
            }
        }
        // Pattern 4: Event subscriptions — SomeManager.OnEvent += Handler
        // Handles both direct (Foo.OnEvent +=) and chained (Foo.Instance.OnEvent +=) patterns.
        if (node.type === "assignment_expression") {
            const operatorNode = node.children.find((c) => c.type === "+=" || c.text === "+=");
            if (operatorNode) {
                const leftNode = node.childForFieldName("left");
                if (leftNode && leftNode.type === "member_access_expression") {
                    const exprNode = leftNode.childForFieldName("expression");
                    if (exprNode) {
                        const rootId = extractRootIdentifier(exprNode);
                        if (rootId !== null &&
                            isUppercase(rootId) &&
                            !UNITY_BUILTIN_TYPES.has(rootId) &&
                            rootId !== sourceClassName) {
                            results.push({
                                sourceClassName,
                                edgeType: "SUBSCRIBES_TO",
                                targetClassName: rootId,
                            });
                        }
                    }
                }
            }
        }
    });
    // Deduplicate relationships
    const seen = new Set();
    const deduped = [];
    for (const rel of results) {
        const key = `${rel.sourceClassName}|${rel.edgeType}|${rel.targetClassName}`;
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(rel);
        }
    }
    tree.delete();
    return deduped;
}
export function extractTypeReferences(content) {
    const parser = getParser();
    if (!parser) {
        throw new Error("Script parser not initialized. Call initScriptParser() first.");
    }
    const tree = parser.parse(content);
    if (!tree)
        return [];
    const results = [];
    const classBodies = collectClassBodies(tree.rootNode);
    walkAll(tree.rootNode, (node) => {
        const sourceClassName = findSourceClass(node.startIndex, classBodies);
        if (!sourceClassName)
            return;
        const typeNodes = [];
        // Pattern 1: field declarations — private T _field;
        if (node.type === "field_declaration") {
            const varDecl = node.namedChildren.find((c) => c.type === "variable_declaration");
            if (varDecl) {
                const typeNode = varDecl.childForFieldName("type");
                if (typeNode)
                    typeNodes.push(typeNode);
            }
        }
        // Pattern 2: method parameters — void Foo(T param) {}
        if (node.type === "parameter") {
            const typeNode = node.childForFieldName("type");
            if (typeNode)
                typeNodes.push(typeNode);
        }
        // Pattern 3: local variable declarations — T x = ...;
        if (node.type === "local_declaration_statement") {
            const varDecl = node.namedChildren.find((c) => c.type === "variable_declaration");
            if (varDecl) {
                const typeNode = varDecl.childForFieldName("type");
                if (typeNode)
                    typeNodes.push(typeNode);
            }
        }
        for (const typeNode of typeNodes) {
            for (const name of typeNamesFromNode(typeNode)) {
                if (isUppercase(name) && !isFilteredType(name)) {
                    results.push({
                        sourceClassName,
                        edgeType: "USES",
                        targetClassName: name,
                    });
                }
            }
        }
    });
    // Deduplicate
    const seen = new Set();
    const deduped = [];
    for (const rel of results) {
        const key = `${rel.sourceClassName}|${rel.edgeType}|${rel.targetClassName}`;
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(rel);
        }
    }
    tree.delete();
    return deduped;
}
//# sourceMappingURL=relationship-extractor.js.map