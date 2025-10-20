from flask import Flask, jsonify
import random

app = Flask(__name__)

@app.route('/random', methods=['GET'])
def get_random_number():
	return jsonify({"number": random.randint(10, 50)})

if __name__ == '__main__':
	app.run(debug=True)
