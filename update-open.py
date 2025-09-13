import requests
import ast

response = requests.get("http://localhost:3000/cases/open-list")
numbers = ast.literal_eval(response.text)

for num in numbers:
    print(num)
