import { Project, SyntaxKind } from "ts-morph";
import * as fs from "fs";
import * as path from "path";

const project = new Project();
const implFilePath = "src/preview/ops/implementation.ts";
const implFile = project.addSourceFileAtPath(implFilePath);

const mappings = {
    "src/preview/ops/geometry.ts": [
        "crop", "cropGeneric", "cropReformat", "cropStitch", "pad", "padOut", 
        "resize", "transform", "flipRotate", "cornerPin", "cameraShake", "distort", "spherize"
    ],
    "src/preview/ops/blend.ts": [
        "merge", "composite", "comp"
    ],
    "src/preview/ops/masks.ts": [
        "imageOpsMask", "channelApply"
    ],
    "src/preview/ops/procedural.ts": [
        "constant", "ramp", "noise", "grain", "text", "draw", "drawMask", "keyer", "stitch"
    ],
    "src/preview/ops/video.ts": [
        "channelSplit", "channelMerge"
    ]
};

const opsObjDecl = implFile.getVariableDeclarationOrThrow("ops");
const opsObj = opsObjDecl.getInitializerIfKindOrThrow(SyntaxKind.ObjectLiteralExpression);

// Export all functions in implementation.ts so they can be imported
for (const func of implFile.getFunctions()) {
    if (!func.isExported()) {
        func.setIsExported(true);
    }
}

let importsToAdd = {};

for (const [filePath, funcs] of Object.entries(mappings)) {
    let extractedCode = "";
    let extractedFuncs = [];
    
    for (const prop of opsObj.getProperties()) {
        if (prop.isKind(SyntaxKind.MethodDeclaration)) {
            const name = prop.getName();
            if (funcs.includes(name)) {
                console.log(`Extracting ${name} to ${filePath}...`);
                const text = prop.getText();
                // Change methodName(...) or async methodName(...) to export [async] function methodName(...)
                const isAsync = prop.isAsync() ? "async " : "";
                
                // We use a regex that matches either name( or async name(
                const regex = new RegExp(`^(async\\s+)?${name}\\s*\\(`);
                const funcText = text.replace(regex, `export ${isAsync}function ${name}(`);
                
                extractedCode += funcText + "\n\n";
                extractedFuncs.push(name);
                
                // Replace the method in opsObj with a property assignment
                prop.replaceWithText(`${name}`);
            }
        }
    }

    if (extractedCode) {
        let destFile = project.addSourceFileAtPathIfExists(filePath);
        if (!destFile) {
            destFile = project.createSourceFile(filePath, "");
        }
        
        // Remove existing Extracted comment and below if script was run before
        const currentText = destFile.getFullText();
        const splitIndex = currentText.indexOf("// Extracted with ts-morph");
        let newText = splitIndex !== -1 ? currentText.substring(0, splitIndex) : currentText;
        
        // Ensure imports exist
        if (!newText.includes("import type { ComfyNode }")) {
            newText = `import type { ComfyNode } from "../../types.js";\n` + newText;
        }
        if (!newText.includes("import * as impl")) {
            newText = `import * as impl from "./implementation.js";\n` + newText;
            // Also need to rewrite the function body to use impl. for missing references, but that's too complex.
            // A simpler approach: we'll just let the user fix the imports or we do it manually after.
        }
        
        destFile.replaceWithText(newText + "\n\n// Extracted with ts-morph\n\n" + extractedCode);
        destFile.saveSync();
        console.log(`Successfully appended to ${filePath}!`);
        
        const moduleName = "./" + path.basename(filePath, ".ts") + ".js";
        importsToAdd[moduleName] = extractedFuncs;
    }
}

// Add imports to implementation.ts
for (const [moduleName, funcs] of Object.entries(importsToAdd)) {
    implFile.addImportDeclaration({
        namedImports: funcs,
        moduleSpecifier: moduleName
    });
}

implFile.saveSync();
console.log("Refactoring complete!");
