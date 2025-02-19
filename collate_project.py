import os

# Directories and file extensions to include
INCLUDE_DIRS = ["client", "server"]
INCLUDE_EXTENSIONS = [".js", ".json", ".html", ".css", ".md", ".sql", ".yml", ".yaml", ".env"]

# Output file
OUTPUT_FILE = "board-game-prototyping-app.txt"

def collate_project(output_file):
    with open(output_file, "w", encoding="utf-8") as out_f:
        for root, dirs, files in os.walk("."):
            # Skip irrelevant directories
            dirs[:] = [d for d in dirs if d in INCLUDE_DIRS]

            for file in files:
                if any(file.endswith(ext) for ext in INCLUDE_EXTENSIONS):
                    file_path = os.path.join(root, file)
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        out_f.write(f"\n\n===== {file_path} =====\n\n")
                        out_f.write(f.read())

    print(f"✅ Project successfully collated into {output_file}")

if __name__ == "__main__":
    collate_project(OUTPUT_FILE)
