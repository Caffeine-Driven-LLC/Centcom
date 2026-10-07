# Command post and branch mode

- **Command post:** one computer (the host) runs the agents; everyone else sends requests to a shared queue.
- **Branch mode:** each person runs their own agents on their own branch, and the session shows who is working on what. File locks warn before two agents touch the same file.

Both modes use the same session; the host picks one when it starts.
