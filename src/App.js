import { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import { auth, provider, db } from "./firebase";
import { signInWithPopup } from "firebase/auth";
import { collection, doc, setDoc, onSnapshot, deleteDoc } from "firebase/firestore";
import axios from "axios";

// Starter templates
const starterTemplates = {
  javascript: `console.log("Hello World");`,
  python: `print("Hello World")`,
  cpp: `#include <iostream>
using namespace std;

int main() {
    cout << "Hello World" << endl;
    return 0;
}`,
  c: `#include <stdio.h>

int main() {
    printf("Hello World\\n");
    return 0;
}`,
  java: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello World");
    }
}`,
  html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Hello World</title>
</head>
<body>
  <h1>Hello World</h1>
</body>
</html>`,
};

function App() {
  const [user, setUser] = useState(null);
  const [files, setFiles] = useState([]);
  const [currentFile, setCurrentFile] = useState(null);
  const [code, setCode] = useState("// Start coding...");
  const [output, setOutput] = useState("");

  const projectId = "demo-project";

  // Login
  const login = async () => {
    const result = await signInWithPopup(auth, provider);
    setUser(result.user);
  };

  // Load files
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      collection(db, "projects", projectId, "files"),
      (snapshot) => {
        const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setFiles(list);

        if (!currentFile && list.length > 0) {
          setCurrentFile(list[0]);
          setCode(list[0].content);
        } else if (currentFile) {
          const updated = list.find((f) => f.name === currentFile.name);
          if (updated && updated.content !== code) {
            setCode(updated.content);
          }
        }
      }
    );

    return () => unsubscribe();
  }, [user, currentFile, code]);

  // Save file
  const saveFile = async (newCode) => {
    if (!currentFile) return;
    setCode(newCode);

    await setDoc(
      doc(db, "projects", projectId, "files", currentFile.name),
      {
        name: currentFile.name,
        language: currentFile.language,
        content: newCode,
        updatedAt: new Date(),
      }
    );
  };

  // New file
  const newFile = async () => {
    const name = prompt("Enter filename (e.g. main.py):");
    if (!name) return;

    let language = "javascript";
    if (name.endsWith(".py")) language = "python";
    if (name.endsWith(".cpp")) language = "cpp";
    if (name.endsWith(".c")) language = "c";
    if (name.endsWith(".java")) language = "java";
    if (name.endsWith(".html")) language = "html";

    const fileData = {
      name,
      language,
      content: starterTemplates[language] || "// New file",
      updatedAt: new Date(),
    };

    await setDoc(doc(db, "projects", projectId, "files", name), fileData);
  };

  // Delete file
  const deleteFile = async (fileName) => {
    const confirmDelete = window.confirm(`Are you sure you want to delete ${fileName}?`);
    if (!confirmDelete) return;

    await deleteDoc(doc(db, "projects", projectId, "files", fileName));

    if (currentFile?.name === fileName) {
      setCurrentFile(null);
      setCode("");
      setOutput("");
    }
  };

  // Run code
  const runCode = async () => {
    if (!currentFile) {
      setOutput("No file selected");
      return;
    }

    const language = currentFile.language;

    // JavaScript: eval
    if (language === "javascript") {
      try {
        let logs = [];
        const originalLog = console.log;

        console.log = (...args) => {
          logs.push(args.join(" "));
          originalLog(...args);
        };

        const result = eval(code);
        console.log = originalLog;

        if (logs.length > 0) setOutput(logs.join("\n"));
        else if (result !== undefined) setOutput(String(result));
        else setOutput("No output");
      } catch (err) {
        setOutput("Error: " + err.message);
      }

    // HTML: iframe preview
    } else if (language === "html") {
      setOutput("");
      const iframe = document.createElement("iframe");
      iframe.style.width = "100%";
      iframe.style.height = "300px";
      iframe.style.border = "1px solid #666";
      const container = document.getElementById("html-output");
      container.innerHTML = "";
      container.appendChild(iframe);
      iframe.contentDocument.open();
      iframe.contentDocument.write(code);
      iframe.contentDocument.close();

    // Other languages: Judge0
    } else {
      try {
        setOutput("⏳ Running your " + language + " code...");

        const languageMap = {
          python: 71,
          cpp: 54,
          c: 50,
          java: 62,
        };

        const response = await axios.post(
          "https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true",
          { source_code: code, language_id: languageMap[language] },
          {
            headers: {
              "Content-Type": "application/json",
              "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
              "X-RapidAPI-Key": "5bde09d0d1msh7bfb1e83d15744fp19d68djsn96274c6c0e0b",
            },
          }
        );

        const result = response.data;

        if (result.stderr) setOutput("❌ Runtime Error:\n" + result.stderr);
        else if (result.compile_output) setOutput("⚠️ Compilation Error:\n" + result.compile_output);
        else if (result.stdout) setOutput(result.stdout.trim());
        else setOutput("✅ Finished with no output");
      } catch (err) {
        setOutput("API Error: " + err.message);
      }
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {!user ? (
        <button onClick={login}>Login with Google</button>
      ) : (
        <>
          {/* Sidebar */}
          <div style={{ width: "220px", background: "#222", color: "#fff", padding: "10px" }}>
            <h4>Files</h4>
            <button onClick={newFile}>+ New File</button>
            <ul style={{ padding: 0 }}>
              {files.map((f) => (
                <li
                  key={f.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    fontWeight: f.name === currentFile?.name ? "bold" : "normal",
                    listStyle: "none",
                  }}
                >
                  <span
                    onClick={() => {
                      setCurrentFile(f);
                      setCode(f.content);
                    }}
                  >
                    {f.name}
                  </span>
                  <button
                    onClick={() => deleteFile(f.name)}
                    style={{
                      background: "red",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      padding: "2px 6px",
                      cursor: "pointer",
                      marginLeft: "5px",
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* Editor + Output */}
          <div style={{ flex: 1 }}>
            {currentFile ? (
              <>
                <h3>Editing: {currentFile.name}</h3>
                <button onClick={runCode}>Run Code</button>
                <Editor
                  height="70vh"
                  language={currentFile.language}
                  value={code}
                  onChange={saveFile}
                />
                <div style={{ background: "#111", color: "lime", padding: "10px" }}>
                  <h4>Output:</h4>
                  {currentFile.language === "html" ? (
                    <div id="html-output" />
                  ) : (
                    <pre>{output}</pre>
                  )}
                </div>
              </>
            ) : (
              <p style={{ padding: "20px" }}>Select a file to start editing</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default App;
