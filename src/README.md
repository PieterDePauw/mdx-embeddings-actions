# Generate embeddings for the markdown files in the docs directory

1. Set up the database connection

2. Set up the OpenAI connection

3. Generate an uuid and a timestamp for the embeddings

4. Create a list of the markdown files in the docs directory

5. For each markdown file, ...

   1. Load the markdown file
   2. Look up the file in the database
   3. If the file is not in the database, generate the embeddings
   4. If the file is in the database, check if the file has changed
   5. If the file has changed (based on the checksum), generate the embeddings
   6. If the file has not changed, do nothing

- loading the markdown files means 'generate a checksum based on the content, extract the metadata and divide the content into sections'

https://excalidraw.com/#json=HM0gJIEx7-6MxbYhYxqpY,uQDdth-t6nbIpo9IYcrNKQ
